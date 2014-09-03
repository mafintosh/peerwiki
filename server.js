#!/usr/bin/env node

var http = require('http')
var peerwiki = require('./')

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

    wiki.findBlobByUrl(url, function(err, entry) {
      if (err) return res.end(err.message)
      res.end(entry)
    })
  })

  server.listen(port, function() {
    console.log('Server is listening on port %d', server.address().port)
  })
})

