// @manifest {"id":"tidal","name":"Tidal","version":"1.0","author":"Melo","description":"Search, stream and browse from Tidal via proxy instances","capabilities":{"rawValue":31}}

// Tidal extension — based on Monochrome (monochrome-music/monochrome) proxy architecture.
// No Tidal account needed. Proxy instances handle authentication internally.

// Instance list source (same as Monochrome)
const GITHUB_INSTANCES_URL = 'https://raw.githubusercontent.com/EduardPrigoana/hifi-instances/refs/heads/main/instances.json';

const FALLBACK_INSTANCES = [
  'https://ohio.monochrome.tf',
  'https://virginia.monochrome.tf',
  'https://oregon.monochrome.tf',
  'https://california.monochrome.tf',
  'https://frankfurt.monochrome.tf',
  'https://singapore.monochrome.tf',
  'https://tokyo.monochrome.tf',
  'https://wolf.qqdl.site',
  'https://maus.qqdl.site',
  'https://vogel.qqdl.site',
  'https://katze.qqdl.site',
  'https://hund.qqdl.site'
];

let instances = null;

async function getInstances() {
  if (instances && instances.length > 0) return instances;

  // Try stored instances first
  const stored = storage.get('instances');
  if (stored && Array.isArray(stored) && stored.length > 0) {
    instances = stored;
    return instances;
  }

  // Fetch from GitHub
  try {
    const res = await http.get(GITHUB_INSTANCES_URL);
    if (res.status === 200 && res.data && res.data.api) {
      const urls = [];
      for (const provider in res.data.api) {
        const info = res.data.api[provider];
        if (info.cors === false && info.urls) {
          urls.push(...info.urls);
        }
      }
      if (urls.length > 0) {
        instances = urls;
        storage.set('instances', urls);
        return instances;
      }
    }
  } catch (e) {
    console.error('Failed to fetch instances: ' + e);
  }

  instances = FALLBACK_INSTANCES;
  return instances;
}

function pickInstance(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// Fetch with retry across instances (mirrors Monochrome's fetchWithRetry)
async function fetchWithRetry(path) {
  const list = await getInstances();
  const errors = [];

  for (let i = 0; i < Math.min(list.length, 5); i++) {
    const base = list[i].replace(/\/$/, '');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await http.get(base + path);
        if (res.status === 200 && res.data) return res.data;
        if (res.status === 429) break; // rate limited, try next instance
      } catch (e) {
        errors.push(e.toString());
      }
    }
  }
  throw new Error('All instances failed: ' + errors.join('; '));
}

function getCoverUrl(coverId, size) {
  if (!coverId) return null;
  const formatted = coverId.replace(/-/g, '/');
  return 'https://resources.tidal.com/images/' + formatted + '/' + size + 'x' + size + '.jpg';
}

function mapTrack(t) {
  if (!t) return null;
  const artistName = t.artist ? t.artist.name : (t.artists && t.artists[0] ? t.artists[0].name : '');
  const artistId = t.artist ? String(t.artist.id) : (t.artists && t.artists[0] ? String(t.artists[0].id) : '');
  return {
    id: String(t.id),
    title: t.title + (t.version ? ' (' + t.version + ')' : ''),
    artist: artistName,
    artistId: artistId,
    albumId: t.album ? String(t.album.id) : '',
    album: t.album ? t.album.title : '',
    duration: t.duration || 0,
    trackNumber: t.trackNumber || 0,
    discNumber: t.volumeNumber || 1,
    bitRate: 1411,
    sampleRate: 44100,
    suffix: 'flac',
    cover: t.album && t.album.cover ? getCoverUrl(t.album.cover, 640) : null,
    isrc: t.isrc || null,
    mediaFileId: String(t.id),
    quality: t.audioQuality || 'LOSSLESS'
  };
}

function mapAlbum(a) {
  if (!a) return null;
  const artistName = a.artist ? a.artist.name : (a.artists && a.artists[0] ? a.artists[0].name : '');
  return {
    id: String(a.id),
    title: a.title,
    name: a.title,
    artist: artistName,
    artistId: a.artist ? String(a.artist.id) : '',
    cover: a.cover ? getCoverUrl(a.cover, 640) : null,
    year: 0,
    genre: '',
    trackCount: a.numberOfTracks || 0,
    releaseDate: a.releaseDate || ''
  };
}

function mapArtist(a) {
  if (!a) return null;
  return {
    id: String(a.id),
    name: a.name,
    image: a.picture ? getCoverUrl(a.picture, 480) : null
  };
}

// Recursively find items array in nested search responses (from Monochrome)
function findItems(obj, key) {
  if (!obj) return [];
  if (obj[key] && obj[key].items) return obj[key].items;
  if (obj.items) return obj.items;
  for (const k in obj) {
    if (typeof obj[k] === 'object' && obj[k] !== null) {
      const found = findItems(obj[k], key);
      if (found.length > 0) return found;
    }
  }
  return [];
}

// Extract stream URL from base64 manifest (from Monochrome api.js)
function extractStreamUrl(manifest) {
  if (!manifest) return null;
  try {
    const decoded = crypto.base64Decode(manifest);
    // Try JSON format first: {"urls":["https://..."]}
    try {
      const parsed = JSON.parse(decoded);
      if (parsed.urls && parsed.urls.length > 0) return parsed.urls[0];
    } catch (e) {}
    // Try plain URL
    const urlMatch = decoded.match(/https?:\/\/[\w\-.~:?#\[\]@!$&'()*+,;=%\/]+/);
    if (urlMatch) return urlMatch[0];
  } catch (e) {}
  return null;
}

const meloExtension = {
  async search(query, page) {
    const encoded = encodeURIComponent(query);
    // Fetch tracks, albums, artists in parallel via Promise.all
    const [tracksData, albumsData, artistsData] = await Promise.all([
      fetchWithRetry('/search/?s=' + encoded).catch(() => null),
      fetchWithRetry('/search/?al=' + encoded).catch(() => null),
      fetchWithRetry('/search/?a=' + encoded).catch(() => null)
    ]);

    const tracks = findItems(tracksData, 'tracks').map(mapTrack).filter(Boolean);
    const albums = findItems(albumsData, 'albums').map(mapAlbum).filter(Boolean);
    const artists = findItems(artistsData, 'artists').map(mapArtist).filter(Boolean);

    return { tracks: tracks, albums: albums, artists: artists, playlists: [] };
  },

  async getAlbums() {
    // No "browse all" in proxy API — return empty, use search
    return [];
  },

  async getAlbumTracks(id) {
    const data = await fetchWithRetry('/album/?id=' + id);
    if (!data) return [];

    // Album response can have tracks in various structures
    let tracks = [];
    if (data.tracks && data.tracks.items) {
      tracks = data.tracks.items;
    } else if (data.items) {
      tracks = data.items;
    } else if (Array.isArray(data)) {
      // Sometimes proxy returns array directly
      tracks = data.filter(t => t.duration);
    }

    return tracks.map(t => {
      // Inherit album info if track doesn't have it
      if (!t.album && data.title) {
        t.album = { id: id, title: data.title, cover: data.cover };
      }
      return mapTrack(t);
    }).filter(Boolean);
  },

  async getArtists() {
    return [];
  },

  async getArtistAlbums(id) {
    const data = await fetchWithRetry('/artist/?f=' + id);
    if (!data) return [];
    const albums = findItems(data, 'albums');
    return albums.map(mapAlbum).filter(Boolean);
  },

  async getArtistTopTracks(id) {
    const data = await fetchWithRetry('/artist/?f=' + id);
    if (!data) return [];
    const tracks = findItems(data, 'tracks') || findItems(data, 'topTracks');
    return tracks.map(mapTrack).filter(Boolean);
  },

  async getSimilarSongs(id) {
    // Not directly available via proxy
    return [];
  },

  async getStreamUrl(trackId, quality) {
    // Accepted values: LOW, HIGH, LOSSLESS, HI_RES_LOSSLESS
    const q = quality || 'LOSSLESS';
    const data = await fetchWithRetry('/track/?id=' + trackId + '&quality=' + q);

    if (!data) throw new Error('No stream data');

    // Handle array response (V1 format from SpotiFLAC's tidal.go)
    if (Array.isArray(data)) {
      for (const item of data) {
        if (item.OriginalTrackUrl) {
          return { url: item.OriginalTrackUrl, format: 'directUrl', quality: q };
        }
      }
    }

    // Handle V2 manifest format
    if (data.data && data.data.manifest) {
      const streamUrl = extractStreamUrl(data.data.manifest);
      if (streamUrl) {
        const isHls = streamUrl.includes('.m3u8') || (data.data.manifestMimeType || '').includes('application/vnd.apple');
        return { url: streamUrl, format: isHls ? 'hls' : 'directUrl', quality: q };
      }
    }

    // Handle direct manifest at top level
    if (data.manifest) {
      const streamUrl = extractStreamUrl(data.manifest);
      if (streamUrl) {
        return { url: streamUrl, format: 'directUrl', quality: q };
      }
    }

    // Handle info array (Monochrome parseTrackLookup pattern)
    if (data.info && data.info.manifest) {
      const streamUrl = extractStreamUrl(data.info.manifest);
      if (streamUrl) return { url: streamUrl, format: 'directUrl', quality: q };
    }

    throw new Error('Could not extract stream URL');
  },

  async getLyrics(trackId, title, artist, album, duration) {
    // Try LRCLIB
    const params = 'track_name=' + encodeURIComponent(title) +
      '&artist_name=' + encodeURIComponent(artist) +
      (duration > 0 ? '&duration=' + Math.round(duration) : '');
    try {
      const res = await http.get('https://lrclib.net/api/get?' + params);
      if (res.status === 200 && res.data) {
        return { synced: res.data.syncedLyrics || null, plain: res.data.plainLyrics || null };
      }
    } catch (e) {}

    throw new Error('No lyrics found');
  },

  async getCoverArt(albumId) {
    // Cover art comes from track/album metadata, not a separate call
    return '';
  },

  async getFeatured() {
    try {
      const data = await fetchWithRetry('/home/');
      if (data && data.albums) {
        return findItems(data, 'albums').map(mapAlbum).filter(Boolean);
      }
    } catch (e) {}
    return [];
  }
};
