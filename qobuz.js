// @manifest {"id":"qobuz","name":"Qobuz","version":"1.1","author":"Melo","description":"Search and stream from Qobuz in Hi-Res quality","capabilities":{"rawValue":31}}

// Qobuz extension — uses dabmusic.xyz for search and streaming.

var DAB_API = 'https://dabmusic.xyz/api';

async function dabGet(path) {
  var res = await http.get(DAB_API + path);
  if (res.status === 200 && res.data) return res.data;
  throw new Error('Qobuz API error: ' + res.status);
}

function mapTrack(t) {
  if (!t || !t.id) return null;
  return {
    id: String(t.id),
    title: t.title + (t.version ? ' (' + t.version + ')' : ''),
    artist: t.artist || '',
    artistId: t.artistId ? String(t.artistId) : '',
    albumId: t.albumId ? String(t.albumId) : '',
    album: t.albumTitle || '',
    duration: t.duration || 0,
    trackNumber: t.trackNumber || 0,
    discNumber: t.mediaNumber || 1,
    bitRate: t.audioQuality && t.audioQuality.maximumBitDepth > 16 ? 2822 : 1411,
    sampleRate: t.audioQuality ? Math.round(t.audioQuality.maximumSamplingRate * 1000) : 44100,
    suffix: 'flac',
    cover: t.albumCover || null,
    isrc: null,
    mediaFileId: String(t.id),
    quality: t.audioQuality && t.audioQuality.isHiRes ? 'HI_RES' : 'LOSSLESS'
  };
}

var meloExtension = {
  async search(query, page) {
    var encoded = encodeURIComponent(query);
    var data = await dabGet('/search?q=' + encoded + '&type=tracks&limit=30');

    var rawTracks = data.tracks || [];
    var tracks = rawTracks.map(mapTrack).filter(function(t) { return t !== null; });

    // Extract unique albums from track results
    var seenAlbums = {};
    var albums = [];
    for (var i = 0; i < rawTracks.length; i++) {
      var t = rawTracks[i];
      if (t.albumId && !seenAlbums[t.albumId]) {
        seenAlbums[t.albumId] = true;
        albums.push({
          id: String(t.albumId),
          title: t.albumTitle || '',
          name: t.albumTitle || '',
          artist: t.artist || '',
          artistId: t.artistId ? String(t.artistId) : '',
          cover: t.albumCover || null,
          year: t.releaseDate ? parseInt(t.releaseDate.substring(0, 4)) : 0,
          genre: t.genre || '',
          trackCount: 0
        });
      }
    }

    // Extract unique artists from track results
    var seenArtists = {};
    var artists = [];
    for (var j = 0; j < rawTracks.length; j++) {
      var tr = rawTracks[j];
      if (tr.artistId && !seenArtists[tr.artistId]) {
        seenArtists[tr.artistId] = true;
        artists.push({
          id: String(tr.artistId),
          name: tr.artist || '',
          image: null
        });
      }
    }

    return { tracks: tracks, albums: albums, artists: artists, playlists: [] };
  },

  async getAlbums() { return []; },

  async getAlbumTracks(id) {
    try {
      var data = await dabGet('/get?type=album&id=' + id);
      if (data && data.tracks) {
        return data.tracks.map(mapTrack).filter(function(t) { return t !== null; });
      }
    } catch (e) {}
    return [];
  },

  async getArtists() { return []; },

  async getArtistAlbums(id) {
    // Search by artist name/id and extract unique albums
    try {
      var data = await dabGet('/search?q=' + encodeURIComponent(id) + '&type=tracks&limit=50');
      var rawTracks = data.tracks || [];
      var seen = {};
      var albums = [];
      for (var i = 0; i < rawTracks.length; i++) {
        var t = rawTracks[i];
        if (t.albumId && !seen[t.albumId] && String(t.artistId) === String(id) || t.artist === id) {
          seen[t.albumId] = true;
          albums.push({
            id: String(t.albumId),
            title: t.albumTitle || '',
            name: t.albumTitle || '',
            artist: t.artist || '',
            artistId: t.artistId ? String(t.artistId) : '',
            cover: t.albumCover || null,
            year: t.releaseDate ? parseInt(t.releaseDate.substring(0, 4)) : 0,
            genre: t.genre || '',
            trackCount: 0
          });
        }
      }
      return albums;
    } catch (e) { return []; }
  },

  async getArtistTopTracks(id) {
    // Search by artist name/id and return matching tracks
    try {
      var data = await dabGet('/search?q=' + encodeURIComponent(id) + '&type=tracks&limit=20');
      var rawTracks = data.tracks || [];
      return rawTracks.map(mapTrack).filter(function(t) { return t !== null; });
    } catch (e) { return []; }
  },

  async getStreamUrl(trackId, quality) {
    var q = quality || '27';

    // Try dabmusic primary
    try {
      var res = await http.get(DAB_API + '/stream?trackId=' + trackId + '&quality=' + q);
      if (res.status === 200 && res.data) {
        var d = res.data;
        var streamUrl = d.url || d.download_url || d.link;
        if (!streamUrl && d.data) streamUrl = d.data.url || d.data.download_url || d.data.link;
        if (streamUrl) return { url: streamUrl, format: 'directUrl', quality: 'LOSSLESS' };
      }
    } catch (e) {}

    // Try dab.yeet.su fallback
    try {
      var res2 = await http.get('https://dab.yeet.su/api/stream?trackId=' + trackId + '&quality=' + q);
      if (res2.status === 200 && res2.data) {
        var d2 = res2.data;
        var url2 = d2.url || d2.download_url || d2.link;
        if (!url2 && d2.data) url2 = d2.data.url || d2.data.download_url || d2.data.link;
        if (url2) return { url: url2, format: 'directUrl', quality: 'LOSSLESS' };
      }
    } catch (e) {}

    throw new Error('No stream available');
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

  async getFeatured() {
    try {
      var data = await dabGet('/search?q=top+hits+2026&type=tracks&limit=30');
      var tracks = data.tracks || [];
      var seen = {};
      var albums = [];
      for (var i = 0; i < tracks.length; i++) {
        var t = tracks[i];
        if (t.albumId && !seen[t.albumId]) {
          seen[t.albumId] = true;
          albums.push({
            id: String(t.albumId),
            title: t.albumTitle || '',
            name: t.albumTitle || '',
            artist: t.artist || '',
            artistId: t.artistId ? String(t.artistId) : '',
            cover: t.albumCover || null,
            year: t.releaseDate ? parseInt(t.releaseDate.substring(0, 4)) : 0,
            genre: t.genre || '',
            trackCount: 0
          });
        }
      }
      return albums.slice(0, 15);
    } catch (e) { return []; }
  }
};
