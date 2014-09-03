# peerwiki

BROWSE ALL OF WIKIPEDIA USING BITTORENT

```
npm install -g peerwiki
```

## Usage

```
peerwiki 9090 # starts a peerwiki server on port 9090
```

And open a browser on http://localhost:9090/BitTorrent

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
})
```

## License

MIT