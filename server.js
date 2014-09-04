#!/usr/bin/env node

var http = require('http')
var request = require('request')
var debug = require('debug')('peerwiki.server')
var peerwiki = require('./')

var USE_INDEX = process.argv.indexOf('--use-index') > -1

var wiki = peerwiki()
var port = Number(process.argv[2]) || 9090

console.log('Verifying previously downloaded data...')

wiki.on('ready', function() {
  var server = http.createServer(function(req, res) {
    var url = decodeURI(req.url.slice(1).split('?')[0])
    if (!url) url = 'BitTorrent'

    if (url === 'favicon.ico') url = 'favicon'
    else if (url === '-/style/style.css') url = 'style/style.css'
    else if (!/^[a-z]\//i.test(url) && url[0] !== '-') {
      res.statusCode = 307
      res.setHeader('Location', 'http://'+req.headers.host+'/A/html/'+url[0]+'/'+url[1]+'/'+url[2]+'/'+url[3]+'/'+url+'.html')
      res.end()
      return
    }

    url = url.replace(/^[a-z]\//i, '') // remove namespace

    if (/\.json$/.test(url)) {
      wiki.findEntryByUrl(url, function(err, entry) {
        if (err) return res.end(err.message)
        res.end(JSON.stringify(entry))
      })
    }

    var fallback = function() {
      debug('using fallback binary search for %s', url)
      wiki.findBlobByUrl(url, function(err, entry) {
        if (err) return res.end(err.message)
        res.end(entry)
      })
    }

    if (!USE_INDEX) return fallback()

    request('http://178.62.147.171/'+url, {json:true}, function(err, response) {
      var body = response.body
      if (!body || !body.offset) return fallback()

      debug('using hot index for %s', url)
      wiki.readCluster(body, function(err, cluster) {
        if (err) return fallback()
        var blob = cluster.blobs[body.blob]
        if (!blob) return fallback()
        res.end(blob)
      })
    })
  })

  server.listen(port, function() {
    console.log('Server is listening on port %d', server.address().port)
  })
})

