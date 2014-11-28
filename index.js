var concat = require('concat-stream')
var torrents = require('torrent-stream')
var fs = require('fs')
var choppa = require('choppa')
var pump = require('pump')
var path = require('path')
var events = require('events')
var through = require('through2')
var storage = require('torrent-individual-piece-storage')
var pretty = require('pretty-bytes')
var debug = require('debug')('peerwiki')

var noop = function() {}

var readUInt64LE = function(buf, offset) {
  var a = buf.readUInt32LE(offset)
  var b = buf.readUInt32LE(offset+4)
  return b * 4294967296 + a
}

var parseHeader = function(data) {
  var header = {}

  header.version = data.readUInt32LE(4)
  header.uuid = data.slice(8, 16).toString('hex')
  header.articleCount = data.readUInt32LE(24)
  header.clusterCount = data.readUInt32LE(28)
  header.urlPtrPos = readUInt64LE(data, 32)
  header.titlePtrPos = readUInt64LE(data, 40)
  header.clusterPtrPos = readUInt64LE(data, 48)
  header.mimeListPos = readUInt64LE(data, 56)
  header.mainPage = data.readUInt32LE(64)
  header.layoutPage = data.readUInt32LE(68)
  header.checksumPos = readUInt64LE(data, 72)

  return header
}

var parseDirectoryEntry = function(data, entry) {
  if (!entry) entry = {}
  if (data.length < 12) return null

  entry.mime = data.readUInt16LE(0)
  entry.namespace = data.toString('utf-8', 3, 4)
  entry.revision = data.readUInt32LE(4)

  var offset = 16

  if (entry.mime === 65535) {
    entry.redirect = data.readUInt32LE(8)
    offset = 12
  } else {
    if (data.length < 16) return null
    entry.cluster = data.readUInt32LE(8)
    entry.blob = data.readUInt32LE(12)
  }

  if (data.length < offset) return null

  var ui = Array.prototype.indexOf.call(data, 0, offset)
  if (ui === -1) return null

  var ti = Array.prototype.indexOf.call(data, 0, ui+1)
  if (ti === -1) return null

  entry.url = data.toString('utf-8', offset, ui)
  entry.title = data.toString('utf-8', ui+1, ti)

  return entry
}

var onerror = function(err) {
  throw err
}

var readHeader = function(file, cb) {
  read(file, 0, 79, function(err, header) {
    if (err) return cb(err)
    cb(null, parseHeader(header))
  })
}

var mock = function() {
  var from = require('from2')
  var file = {}
  file.select = function() {}
  file.createReadStream = function(opts) {
    var offset = opts.start || 0
    var first = offset % 1048576
    var len = (opts.end || Infinity) - offset + 1
    return from(function(size, cb) {
      if (!len) return cb(null, null)
      var file = Math.floor(offset / 1048576) + ''
      file = '00000'.slice(file.length)+file+'.piece'
      fs.readFile('data/'+file, function(err, buf) {
        if (err) return cb(null)
        buf = buf.slice(first)
        first = 0
        if (buf.length > len) buf = buf.slice(0, len)
        len -= buf.length
        offset += buf.length
        cb(null, buf)
      })
    })
  }
  return file
}

var read = function(file, start, end, cb) {
  var stream = file.createReadStream({start:start, end:end})
  stream.pipe(concat({encoding:'buffer'}, function(data) {
    cb(null, data)
  }))

  return function() {
    stream.destroy()
  }
}

var readOffset = function(file, offset, entry, cb) {
  var start = offset+entry.index*8
  var end = start+8-1

  return read(file, start, end, function(err, buf) {
    if (err) return cb(err)
    if (buf.length < 8) return cb(new Error('Not enough data'))
    entry.offset = readUInt64LE(buf, 0)
    cb()
  })
}

var createOffsetStream = function(file, start, cnt, opts) {
  if (!opts) opts = {}

  if (opts.start) {
    start += opts.start * 8
    cnt -= opts.start
  }
  if (opts.end) {
    cnt -= opts.end - (opts.start || 0) + 1
  }

  var stream = file.createReadStream({start:start, end:start+8*cnt-1})
  var i = 0

  var parse = through.obj(function(data, enc, cb) {
    cb(null, {
      index: i++,
      offset: readUInt64LE(data, 0)
    })
  })

  return pump(stream, choppa(8), parse)
}

var destroyer = function() {
  var destroyFn = noop
  var destroy = function() {
    debug('destroying call')
    if (destroyFn) destroyFn()
  }
  destroy.set = function(fn) {
    destroyFn = fn
    return destroy
  }
  return destroy
}

var populate = function(that, file, header, engine) {
  that.header = header

  that.readCluster = function(cluster, cb) {
    var destroy = destroyer()

    var ready = function(err) {
      if (err) return cb(err)
      if (cluster.blobs === false) return cb(null, cluster)

      destroy.set(read(file, cluster.offset, cluster.offset, function(err, compressed) {
        compressed = compressed[0]
        debug('cluster is compressed? %s (%d)', compressed !== 0, compressed)

        var stream = file.createReadStream({start:cluster.offset+1, end:cluster.offset+1500000}) // haxx - TODO: fix me
        var decomp = compressed < 2 ? through() : new (require('lzma-native').Decompressor)
        var indexes = []
        var blobs = []

        var index = function(data) {
          while (data.length) {
            var offset = data.readUInt32LE(indexes.length * 4)
            indexes.push(offset)
            if (offset >= data.length) return
          }
        }

        stream.pipe(decomp).pipe(concat(function(data) {
          stream.destroy()
          index(data)

          for (var i = 0; i < indexes.length-1; i++) blobs.push(data.slice(indexes[i], indexes[i+1]))
          cluster.blobs = blobs
          cb(null, cluster)
        }))

        destroy.set(function() {
          stream.destroy()
        })
      }))
    }

    if (cluster.offset !== undefined) {
      ready()
      return destroy
    }

    return destroy.set(readOffset(file, header.clusterPtrPos, cluster, ready))
  }

  that.readClusterEntry = function(cluster, cb) {
    if (cluster.offset !== undefined) {
      cb(null, cluster)
      return noop
    }

    return readOffset(file, header.clusterPtrPos, cluster, function(err) {
      if (err) return cb(err)
      cb(null, cluster)
    })
  }

  that.findEntryByUrl = function(url, cb) {
    var top = header.articleCount-1
    var btm = 2

    // haxx - 1+2 are not sorted - special?
    if (url === 'favicon') return that.readDirectoryEntry({index:0}, cb)
    if (url === 'style/style.css') return that.readDirectoryEntry({index:1}, cb)

    // binary search
    debug('searching for %s started', url)

    var destroy = destroyer()

    var search = function(btm, top) {
      var mid = ((top+btm) / 2)|0
      if (top < btm) {
        debug('could not find %s', url)
        return cb(null, null)
      }

      destroy.set(that.readDirectoryEntry({index:mid}, function(err, entry) {
        if (err) return cb(err)

        var murl = entry.url
        debug('searching for %s, found %s', url, murl)

        if (murl.toLowerCase() === url.toLowerCase()) return cb(null, entry)

        if (murl > url) search(btm, mid-1)
        else search(mid+1, top)
      }))
    }

    search(btm, top)
    return destroy
  }

  that.findBlobByUrl = function(url, cb) {
    var destroy = destroyer()

    return destroy.set(that.findEntryByUrl(url, function loop(err, entry) {
      if (err) return cb(err)
      if (!entry) return cb(null, null)
      if (entry.redirect !== undefined) return destroy.set(that.readDirectoryEntry({index:entry.redirect}, loop))

      if (entry.cluster === undefined || entry.blob === undefined) return cb(new Error('No blob available'))

      destroy.set(that.readCluster({index:entry.cluster}, function(err, cluster) {
        if (err) return cb(err)
        cb(null, cluster.blobs[entry.blob])
      }))
    }))
  }

  that.readDirectoryEntry = function(entry, cb) {
    var destroy = destroyer()

    var ready = function(err) {
      if (err) return cb(err)

      var stream = file.createReadStream({start:entry.offset})

      var data = null
      var parse = through(function(buf, enc, next) {
        data = data ? Buffer.concat([data, buf]) : buf
        var result = parseDirectoryEntry(data, entry)
        if (!result) return next()
        stream.destroy()
        cb(null, result)
      })

      stream.pipe(parse)
      destroy.set(function() {
        stream.destroy()
      })
    }

    if (entry.offset !== undefined) {
      ready()
      return destroy
    }

    return destroy.set(readOffset(file, header.urlPtrPos, entry, ready))
  }

  that.createClusterPointerStream = function(opts) {
    return createOffsetStream(file, header.clusterPtrPos, header.clusterCount, opts)
  }

  that.createEntryPointerStream = function(opts) {
    return createOffsetStream(file, header.urlPtrPos, header.articleCount, opts)
  }

  that.listen = function(port) {
    engine.listen(port)
  }

  return that
}

var connect = function(opts) {
  if (!opts) opts = {}

  var that = new events.EventEmitter()

  var engine = that.engine = torrents(fs.readFileSync(path.join(__dirname, 'wikipedia.torrent')), {
    storage: storage,
    path: opts.path || 'peerwiki'
  })

  var active = function(wires) {
    var result = 0
    for (var i = 0; i < wires.length; i++) {
      if (!wires[i].peerChoking) result++
    }
    return result
  }

  var ready = function() {
    if (engine && engine.files) {
      var file = engine.files[0]
      if (!opts.onDemand) file.select()
    } else {
      var file = mock()
    }

    if (process.env.DEBUG) {
      setInterval(function() {
        debug('connected to %d/%d (%s/s) peers', active(engine.swarm.wires), engine.swarm.wires.length, pretty(engine.swarm.downloadSpeed()))
      }, 5000).unref()
    }

    debug('fetching required wikipedia header...')
    readHeader(file, function(err, header) {
      if (err) return that.emit('error', err)
      debug('succesfully fetched wikipedia header!')
      populate(that, file, header, engine)
      that.emit('ready')
    })
  }

  engine.on('ready', function() {
    debug('engine is ready')
    engine.on('download', function(i) {
      debug('engine downloaded downloaded piece %d', i)
    })
    ready()
  })

  return that
}

module.exports = connect
