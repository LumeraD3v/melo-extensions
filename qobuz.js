// @manifest {"id":"qobuz","name":"Qobuz","version":"1.0","author":"Melo","description":"Search, stream and browse from Qobuz via proxy APIs","capabilities":{"rawValue":31}}

// Qobuz extension — based on SpotiFLAC (go_backend/qobuz.go) and DAB Music (dabmusic.xyz).
// No Qobuz account needed. Proxy APIs handle authentication.

const QOBUZ_APP_ID = '798273057';
const QOBUZ_API = 'https://www.qobuz.com/api.json/0.2';

// Streaming proxies (from SpotiFLAC go_backend/qobuz.go parallel race list)
const STREAM_PROXIES = [
  { name: 'dabmusic', url: 'https://dabmusic.xyz/api/stream', method: 'GET', paramStyle: 'query' },
  { name: 'deeb', url: 'https://dab.yeet.su/api/stream', method: 'GET', paramStyle: 'query' },
  { name: 'squid', url: 'https://qobuz.squid.wtf/api/download-music', method: 'GET', paramStyle: 'squid' }
];

function getCoverUrl(imageObj, maxQuality) {
  if (!imageObj) return null;
  if (typeof imageObj === 'string') return imageObj;
  // Upgrade to max quality (from SpotiFLAC cover.go)
  if (maxQuality && imageObj.large) {
    return imageObj.large.replace(/_\d+\.jpg/, '_max.jpg');
  }
  return imageObj.large || imageObj.small || imageObj.thumbnail || null;
}

function mapTrack(t) {
  if (!t) return null;
  const artistName = t.performer ? t.performer.name :
    (t.album && t.album.artist ? t.album.artist.name : '');
  const artistId = t.performer ? String(t.performer.id) :
    (t.album && t.album.artist ? String(t.album.artist.id) : '');
  return {
    id: String(t.id),
    title: t.title + (t.version ? ' (' + t.version + ')' : ''),
    artist: artistName,
    artistId: artistId,
    albumId: t.album ? String(t.album.id || t.album.qobuz_id || '') : '',
    album: t.album ? t.album.title : '',
    duration: t.duration || 0,
    trackNumber: t.track_number || 0,
    discNumber: t.media_number || 1,
    bitRate: (t.maximum_bit_depth || 16) * (t.maximum_sampling_rate || 44100) / 1000,
    sampleRate: Math.round((t.maximum_sampling_rate || 44100)),
    suffix: 'flac',
    cover: t.album ? getCoverUrl(t.album.image, true) : null,
    isrc: t.isrc || null,
    mediaFileId: String(t.id),
    quality: (t.maximum_bit_depth || 0) > 16 ? 'HI_RES' : 'LOSSLESS'
  };
}

function mapAlbum(a) {
  if (!a) return null;
  const artistName = a.artist ? a.artist.name :
    (a.artists && a.artists[0] ? a.artists[0].name : '');
  return {
    id: String(a.id || a.qobuz_id || ''),
    title: a.title,
    name: a.title,
    artist: artistName,
    artistId: a.artist ? String(a.artist.id) : '',
    cover: getCoverUrl(a.image, true),
    year: a.release_date_original ? parseInt(a.release_date_original.substring(0, 4)) : 0,
    genre: a.genre ? a.genre.name : '',
    trackCount: a.tracks_count || 0,
    releaseDate: a.release_date_original || ''
  };
}

function mapArtist(a) {
  if (!a) return null;
  return {
    id: String(a.id),
    name: a.name,
    image: a.image ? getCoverUrl(a.image, false) : null
  };
}

async function qobuzApi(endpoint, params) {
  const allParams = Object.assign({}, params, { app_id: QOBUZ_APP_ID });
  const qs = Object.entries(allParams)
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
    .join('&');
  const res = await http.get(QOBUZ_API + '/' + endpoint + '?' + qs);
  if (res.status === 200) return res.data;
  throw new Error('Qobuz API error: ' + res.status);
}

// Parallel race streaming (mirrors SpotiFLAC's Go goroutine pattern)
async function getStreamUrlRace(trackId, quality) {
  const promises = STREAM_PROXIES.map(async (proxy) => {
    try {
      let url;
      if (proxy.paramStyle === 'squid') {
        url = proxy.url + '?country=US&track_id=' + trackId + '&quality=' + quality;
      } else {
        url = proxy.url + '?trackId=' + trackId + '&quality=' + quality;
      }
      const res = await http.get(url);
      if (res.status === 200 && res.data) {
        // Extract URL from response (from SpotiFLAC qobuz.go extractDownloadURL)
        const d = res.data;
        const streamUrl = d.download_url || d.url || d.link ||
          (d.data ? (d.data.download_url || d.data.url || d.data.link) : null);
        if (streamUrl) return streamUrl;
      }
      throw new Error(proxy.name + ' failed');
    } catch (e) {
      throw e;
    }
  });

  // Race — first success wins
  return Promise.any(promises);
}

const meloExtension = {
  async search(query, page) {
    const limit = 20;
    const [tracksRes, albumsRes, artistsRes] = await Promise.all([
      qobuzApi('track/search', { query: query, limit: limit }).catch(() => null),
      qobuzApi('album/search', { query: query, limit: 10 }).catch(() => null),
      qobuzApi('artist/search', { query: query, limit: 5 }).catch(() => null)
    ]);

    const tracks = (tracksRes && tracksRes.tracks ? tracksRes.tracks.items : []).map(mapTrack).filter(Boolean);
    const albums = (albumsRes && albumsRes.albums ? albumsRes.albums.items : []).map(mapAlbum).filter(Boolean);
    const artists = (artistsRes && artistsRes.artists ? artistsRes.artists.items : []).map(mapArtist).filter(Boolean);

    return { tracks: tracks, albums: albums, artists: artists, playlists: [] };
  },

  async getAlbums() {
    return [];
  },

  async getAlbumTracks(id) {
    const data = await qobuzApi('album/get', { album_id: id });
    if (!data || !data.tracks || !data.tracks.items) return [];
    return data.tracks.items.map(t => {
      // Inherit album info
      if (!t.album) t.album = { id: data.id, title: data.title, image: data.image, artist: data.artist };
      return mapTrack(t);
    }).filter(Boolean);
  },

  async getArtists() {
    return [];
  },

  async getArtistAlbums(id) {
    const data = await qobuzApi('artist/get', { artist_id: id, extra: 'albums', limit: 50 });
    if (!data || !data.albums || !data.albums.items) return [];
    return data.albums.items.map(mapAlbum).filter(Boolean);
  },

  async getArtistTopTracks(id) {
    // Qobuz doesn't have a direct top tracks endpoint — search by artist name
    return [];
  },

  async getSimilarSongs(id) {
    return [];
  },

  async getStreamUrl(trackId, quality) {
    const q = quality || '27';
    // Map quality codes: 6 = CD (16/44.1), 7 = Hi-Res (24/96), 27 = Hi-Res Max (24/192)
    const qobuzQuality = q === '6' ? '6' : q === '7' ? '7' : '27';

    const streamUrl = await getStreamUrlRace(trackId, qobuzQuality);
    return { url: streamUrl, format: 'directUrl', quality: q };
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
      const data = await qobuzApi('album/getFeatured', { type: 'new-releases', limit: 20 });
      if (data && data.albums && data.albums.items) {
        return data.albums.items.map(mapAlbum).filter(Boolean);
      }
    } catch (e) {}
    return [];
  }
};
