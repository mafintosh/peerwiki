var through = require('through2')
var path = require('path')
var level = require('level')
var varint = require('varint')
var peerwiki = require('./')

var i = 0
var db = level(path.join(__dirname, 'index.db'))
var wiki = peerwiki()

wiki.on('ready', function() {
  wiki.createEntryPointerStream()
    .pipe(through.obj(function(entry, enc, cb) {
      wiki.readDirectoryEntry(entry, cb)
    }))
    .pipe(through.obj(function(entry, enc, cb) {
      var read = function(err, entry) {
        if (err) return cb(err)
        if (entry.redirect !== undefined && entry.index === entry.redirect) return cb()
        if (entry.cluster === undefined) return cb()
        if (entry.index === entry.redirect) return cb()

        wiki.readCluster({index:entry.cluster, blobs:false}, function(err, cluster) {
          if (err) return cb(err)

          cb(null, {
            key: entry.url,
            value: Buffer.concat([new Buffer(varint.encode(cluster.offset)), new Buffer(varint.encode(entry.blob))])
          })
        })
      }

      read(null, entry)
    }))
    .pipe(through.obj(function(data, enc, cb) {
      console.log('Indexed #%d %s', i++, data.key)
      db.put(data.key, data.value, function(err) {
        if (err) return cb(err)
        cb()
      })
    }))
    .on('finish', function() {
      process.exit(0)
    })
})