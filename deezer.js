// @manifest {"id":"deezer","name":"Deezer","version":"1.0","author":"Melo","description":"Search and stream from Deezer via proxy APIs","capabilities":{"rawValue":31}}

// Deezer extension — metadata from public API, streaming via MusicDL proxy.
// Based on SpotiFLAC (go_backend/deezer.go, deezer_download.go).
// No Deezer account needed.

const DEEZER_API = 'https://api.deezer.com/2.0';

// Streaming proxy (from SpotiFLAC go_backend/deezer_download.go)
const MUSICDL_URL = 'https://www.musicdl.me/api/download';

function getCoverUrl(album, size) {
  // Deezer cover sizes: 56, 250, 500, 1000, 1400, 1800
  // Upgrade to max (from SpotiFLAC cover.go)
  if (album.cover_xl) return album.cover_xl.replace(/\d+x\d+/, '1800x1800');
  if (album.cover_big) return album.cover_big;
  if (album.cover_medium) return album.cover_medium;
  if (album.cover) return album.cover;
  // Build from MD5
  if (album.md5_image) {
    return 'https://cdn-images.dzcdn.net/images/cover/' + album.md5_image + '/' + size + 'x' + size + '-000000-80-0-0.jpg';
  }
  return null;
}

function mapTrack(t) {
  if (!t) return null;
  const artistName = t.artist ? t.artist.name : '';
  return {
    id: String(t.id),
    title: t.title || t.title_short || '',
    artist: artistName,
    artistId: t.artist ? String(t.artist.id) : '',
    albumId: t.album ? String(t.album.id) : '',
    album: t.album ? t.album.title : '',
    duration: t.duration || 0,
    trackNumber: t.track_position || 0,
    discNumber: t.disk_number || 1,
    bitRate: 1411,
    sampleRate: 44100,
    suffix: 'flac',
    cover: t.album ? getCoverUrl(t.album, 1000) : null,
    isrc: t.isrc || null,
    mediaFileId: String(t.id),
    quality: 'LOSSLESS'
  };
}

function mapAlbum(a) {
  if (!a) return null;
  const artistName = a.artist ? a.artist.name : '';
  return {
    id: String(a.id),
    title: a.title,
    name: a.title,
    artist: artistName,
    artistId: a.artist ? String(a.artist.id) : '',
    cover: getCoverUrl(a, 1000),
    year: a.release_date ? parseInt(a.release_date.substring(0, 4)) : 0,
    genre: a.genre_id ? '' : '',
    trackCount: a.nb_tracks || 0,
    releaseDate: a.release_date || ''
  };
}

function mapArtist(a) {
  if (!a) return null;
  return {
    id: String(a.id),
    name: a.name,
    image: a.picture_xl || a.picture_big || a.picture_medium || a.picture || null
  };
}

async function deezerApi(endpoint) {
  const res = await http.get(DEEZER_API + '/' + endpoint);
  if (res.status === 200 && res.data && !res.data.error) return res.data;
  throw new Error('Deezer API error');
}

const extension = {
  async search(query, page) {
    const encoded = encodeURIComponent(query);
    const [tracksRes, albumsRes, artistsRes] = await Promise.all([
      deezerApi('search?q=' + encoded + '&limit=20').catch(() => null),
      deezerApi('search/album?q=' + encoded + '&limit=10').catch(() => null),
      deezerApi('search/artist?q=' + encoded + '&limit=5').catch(() => null)
    ]);

    const tracks = (tracksRes && tracksRes.data ? tracksRes.data : []).map(mapTrack).filter(Boolean);
    const albums = (albumsRes && albumsRes.data ? albumsRes.data : []).map(mapAlbum).filter(Boolean);
    const artists = (artistsRes && artistsRes.data ? artistsRes.data : []).map(mapArtist).filter(Boolean);

    return { tracks: tracks, albums: albums, artists: artists, playlists: [] };
  },

  async getAlbums() {
    return [];
  },

  async getAlbumTracks(id) {
    const data = await deezerApi('album/' + id);
    if (!data || !data.tracks || !data.tracks.data) return [];
    return data.tracks.data.map(t => {
      if (!t.album) t.album = { id: data.id, title: data.title, cover_xl: data.cover_xl, cover_big: data.cover_big, md5_image: data.md5_image };
      return mapTrack(t);
    }).filter(Boolean);
  },

  async getArtists() {
    return [];
  },

  async getArtistAlbums(id) {
    const data = await deezerApi('artist/' + id + '/albums?limit=50');
    if (!data || !data.data) return [];
    return data.data.map(mapAlbum).filter(Boolean);
  },

  async getArtistTopTracks(id) {
    const data = await deezerApi('artist/' + id + '/top?limit=20');
    if (!data || !data.data) return [];
    return data.data.map(mapTrack).filter(Boolean);
  },

  async getSimilarSongs(id) {
    try {
      const data = await deezerApi('artist/' + id + '/related?limit=10');
      if (data && data.data) return data.data.map(mapArtist).filter(Boolean);
    } catch (e) {}
    return [];
  },

  async getStreamUrl(trackId, quality) {
    // Use MusicDL proxy (from SpotiFLAC deezer_download.go)
    // POST with platform:"deezer" and the track URL
    const deezerUrl = 'https://www.deezer.com/track/' + trackId;

    const res = await http.post(MUSICDL_URL, {
      platform: 'deezer',
      url: deezerUrl
    }, { 'Content-Type': 'application/json' });

    if (res.status === 200 && res.data) {
      const d = res.data;
      // Extract URL (from SpotiFLAC deezer_download.go extractDownloadURL pattern)
      const streamUrl = d.download_url || d.url || d.link ||
        (d.data ? (d.data.download_url || d.data.url || d.data.link) : null);

      if (streamUrl) {
        return { url: streamUrl, format: 'directUrl', quality: quality || 'LOSSLESS' };
      }
    }

    throw new Error('Deezer stream not available');
  },

  async getLyrics(trackId, title, artist, album, duration) {
    const params = 'track_name=' + encodeURIComponent(title) +
      '&artist_name=' + encodeURIComponent(artist) +
      (duration > 0 ? '&duration=' + Math.round(duration) : '');
    const res = await http.get('https://lrclib.net/api/get?' + params);
    if (res.status === 200 && res.data) {
      return { synced: res.data.syncedLyrics || null, plain: res.data.plainLyrics || null };
    }
    throw new Error('No lyrics found');
  },

  async getCoverArt(albumId) {
    return '';
  },

  async getFeatured() {
    try {
      const data = await deezerApi('chart/0/albums?limit=20');
      if (data && data.data) return data.data.map(mapAlbum).filter(Boolean);
    } catch (e) {}
    return [];
  }
};
