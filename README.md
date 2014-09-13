# peerwiki

BROWSE ALL OF WIKIPEDIA USING BITTORENT

```
npm install -g peerwiki
```

## Usage

```
peerwiki 9090 # starts a peerwiki server on port 9090
```

To get more debug output do

```
DEBUG=peerwiki peerwiki 9090
```

This can useful the first time you start browsing since it needs to some download some shared static assets which can result in a added latency

To use a pregenerated index (will speed up page load) do

```
peerwiki 9090 --use-index
```

And open a browser on [http://localhost:9090/BitTorrent](http://localhost:9090/BitTorrent)

## Cache

When downloading articles they are cached on your local file system in `./peerwiki`.

## Programmatic usage

``` js
var peerwiki = require('peerwiki')
var wiki = peerwiki(function() {
  // wiki is ready

  // fetch the BitTorrent article metadata from other peers
  wiki.findEntryByUrl('html/B/i/t/T/BitTorrent', function(err, result) {
    console.log(result)
  })

  // fetch the actual article from other peers
  wiki.findBlobByUrl('html/B/i/t/T/BitTorrent', function(err, buf) {
    console.log(buf)
  })

  wiki.listen(9091) // listen for p2p connections on port 9091
})
```

## License

MIT
