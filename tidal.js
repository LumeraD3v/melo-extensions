// @manifest {"id":"tidal","name":"Tidal","version":"1.1","author":"Melo","description":"Search and stream from Tidal via proxy instances","capabilities":{"rawValue":31}}

// Tidal extension — uses qqdl.site proxy instances.

var INSTANCES = [
  'https://wolf.qqdl.site',
  'https://maus.qqdl.site',
  'https://vogel.qqdl.site',
  'https://katze.qqdl.site',
  'https://hund.qqdl.site'
];

function pickInstance() {
  return INSTANCES[Math.floor(Math.random() * INSTANCES.length)];
}

async function tidalGet(path) {
  var errors = [];
  for (var i = 0; i < Math.min(INSTANCES.length, 3); i++) {
    var base = INSTANCES[i];
    try {
      var res = await http.get(base + path);
      if (res.status === 200 && res.data) return res.data;
    } catch (e) {
      errors.push(e.toString());
    }
  }
  throw new Error('All instances failed');
}

function getCoverUrl(coverId, size) {
  if (!coverId) return null;
  var formatted = String(coverId).replace(/-/g, '/');
  return 'https://resources.tidal.com/images/' + formatted + '/' + size + 'x' + size + '.jpg';
}

function mapTrack(t) {
  if (!t || !t.id) return null;
  var artistName = '';
  var artistId = '';
  if (t.artist && t.artist.name) {
    artistName = t.artist.name;
    artistId = String(t.artist.id || '');
  } else if (t.artists && t.artists.length > 0) {
    artistName = t.artists[0].name || '';
    artistId = String(t.artists[0].id || '');
  }
  var albumTitle = '';
  var albumId = '';
  var cover = null;
  if (t.album) {
    albumTitle = t.album.title || '';
    albumId = String(t.album.id || '');
    cover = t.album.cover ? getCoverUrl(t.album.cover, 640) : null;
  }
  return {
    id: String(t.id),
    title: t.title || '',
    artist: artistName,
    artistId: artistId,
    albumId: albumId,
    album: albumTitle,
    duration: t.duration || 0,
    trackNumber: t.trackNumber || 0,
    discNumber: t.volumeNumber || 1,
    bitRate: 1411,
    sampleRate: 44100,
    suffix: 'flac',
    cover: cover,
    isrc: t.isrc || null,
    mediaFileId: String(t.id),
    quality: t.audioQuality || 'LOSSLESS'
  };
}

var meloExtension = {
  async search(query, page) {
    var encoded = encodeURIComponent(query);
    var data = await tidalGet('/search/?s=' + encoded);

    var items = [];
    if (data && data.data && data.data.items) {
      items = data.data.items;
    } else if (data && data.items) {
      items = data.items;
    }

    var tracks = items.map(mapTrack).filter(function(t) { return t !== null; });
    return { tracks: tracks, albums: [], artists: [], playlists: [] };
  },

  async getAlbums() { return []; },

  async getAlbumTracks(id) {
    var data = await tidalGet('/album/?id=' + id);
    var items = [];
    if (data && data.data && data.data.items) items = data.data.items;
    else if (data && data.items) items = data.items;
    else if (data && data.tracks && data.tracks.items) items = data.tracks.items;
    return items.map(function(item) {
      return mapTrack(item.item || item);
    }).filter(function(t) { return t !== null; });
  },

  async getArtists() { return []; },
  async getArtistAlbums(id) { return []; },
  async getArtistTopTracks(id) { return []; },

  async getStreamUrl(trackId, quality) {
    var q = quality || 'LOSSLESS';
    var data = await tidalGet('/track/?id=' + trackId + '&quality=' + q);
    if (!data) throw new Error('No stream data');

    var streamData = data.data || data;

    if (streamData.manifest) {
      var decoded = crypto.base64Decode(streamData.manifest);
      try {
        var parsed = JSON.parse(decoded);
        if (parsed.urls && parsed.urls.length > 0) {
          return { url: parsed.urls[0], format: 'directUrl', quality: q };
        }
      } catch (e) {}
      var urlMatch = decoded.match(/https?:\/\/[^\s"<]+/);
      if (urlMatch) {
        return { url: urlMatch[0], format: 'directUrl', quality: q };
      }
    }

    if (Array.isArray(data)) {
      for (var i = 0; i < data.length; i++) {
        if (data[i].OriginalTrackUrl) {
          return { url: data[i].OriginalTrackUrl, format: 'directUrl', quality: q };
        }
      }
    }

    throw new Error('Could not extract stream URL');
  },

  async getLyrics(trackId, title, artist, album, duration) {
    var params = 'track_name=' + encodeURIComponent(title) +
      '&artist_name=' + encodeURIComponent(artist) +
      (duration > 0 ? '&duration=' + Math.round(duration) : '');
    var res = await http.get('https://lrclib.net/api/get?' + params);
    if (res.status === 200 && res.data) {
      return { synced: res.data.syncedLyrics || null, plain: res.data.plainLyrics || null };
    }
    throw new Error('No lyrics found');
  },

  async getCoverArt(albumId) { return ''; },
  async getFeatured() { return []; }
};
