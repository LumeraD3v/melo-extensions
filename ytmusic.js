// @manifest {"id":"ytmusic","name":"YouTube Music","version":"1.0","author":"Melo","description":"Search and stream from YouTube Music via Piped instances","capabilities":{"rawValue":31}}

// YouTube Music extension — uses Piped API (YouTube proxy with server-side cipher handling).
// No account needed. Audio URLs are ready-to-play direct streams.

const INSTANCES_URL = 'https://piped-instances.kavin.rocks';

const FALLBACK_INSTANCES = [
  'https://api.piped.private.coffee',
  'https://pipedapi.r4fo.com',
  'https://pipedapi.darkness.services',
  'https://api.piped.yt'
];

let instances = null;

async function getInstances() {
  if (instances && instances.length > 0) return instances;

  const stored = storage.get('pipedInstances');
  if (stored && Array.isArray(stored) && stored.length > 0) {
    instances = stored;
    return instances;
  }

  try {
    const res = await http.get(INSTANCES_URL);
    if (res.status === 200 && Array.isArray(res.data)) {
      const urls = res.data
        .filter(i => i.api_url && i.up_to_date !== false)
        .sort((a, b) => (b.uptime_30d || 0) - (a.uptime_30d || 0))
        .map(i => i.api_url);
      if (urls.length > 0) {
        instances = urls;
        storage.set('pipedInstances', urls);
        return instances;
      }
    }
  } catch (e) {
    console.error('Failed to fetch Piped instances: ' + e);
  }

  instances = FALLBACK_INSTANCES;
  return instances;
}

function pickInstance(list) {
  return list[Math.floor(Math.random() * list.length)];
}

async function pipedGet(path) {
  const list = await getInstances();
  const errors = [];

  for (let i = 0; i < Math.min(list.length, 4); i++) {
    const base = list[i].replace(/\/$/, '');
    try {
      const res = await http.get(base + path);
      if (res.status === 200 && res.data) return res.data;
    } catch (e) {
      errors.push(e.toString());
    }
  }
  throw new Error('All Piped instances failed: ' + errors.join('; '));
}

function extractVideoId(url) {
  if (!url) return null;
  // /watch?v=xxxxx
  const match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (match) return match[1];
  // /shorts/xxxxx or direct ID
  const match2 = url.match(/\/([a-zA-Z0-9_-]{11})$/);
  if (match2) return match2[1];
  return url;
}

function extractPlaylistId(url) {
  if (!url) return null;
  const match = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  return url;
}

function extractChannelId(url) {
  if (!url) return null;
  const match = url.match(/\/channel\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  return url;
}

function parseDuration(seconds) {
  return typeof seconds === 'number' ? seconds : 0;
}

function getBestThumbnail(url) {
  if (!url) return null;
  // Upgrade to high quality
  return url.replace(/hqdefault/, 'maxresdefault').replace(/sddefault/, 'maxresdefault');
}

function mapStreamItem(item) {
  if (!item) return null;
  const videoId = extractVideoId(item.url);
  if (!videoId) return null;

  return {
    id: videoId,
    title: item.title || '',
    artist: item.uploaderName || item.uploader || '',
    artistId: extractChannelId(item.uploaderUrl) || '',
    albumId: '',
    album: '',
    duration: parseDuration(item.duration),
    trackNumber: 0,
    discNumber: 1,
    bitRate: 128,
    sampleRate: 44100,
    suffix: 'm4a',
    cover: getBestThumbnail(item.thumbnail),
    isrc: null,
    mediaFileId: videoId,
    quality: 'HIGH'
  };
}

function mapPlaylistItem(item) {
  if (!item) return null;
  const playlistId = extractPlaylistId(item.url);
  return {
    id: playlistId || '',
    title: item.name || item.title || '',
    name: item.name || item.title || '',
    artist: item.uploaderName || item.uploader || '',
    artistId: extractChannelId(item.uploaderUrl) || '',
    cover: getBestThumbnail(item.thumbnail),
    year: 0,
    genre: '',
    trackCount: item.videos || 0,
    releaseDate: ''
  };
}

function mapChannelItem(item) {
  if (!item) return null;
  return {
    id: extractChannelId(item.url) || '',
    name: item.name || '',
    image: getBestThumbnail(item.thumbnail)
  };
}

const extension = {
  async search(query, page) {
    const encoded = encodeURIComponent(query);

    // Search songs, albums, artists in parallel
    const [songsData, albumsData, artistsData] = await Promise.all([
      pipedGet('/search?q=' + encoded + '&filter=music_songs').catch(() => null),
      pipedGet('/search?q=' + encoded + '&filter=music_albums').catch(() => null),
      pipedGet('/search?q=' + encoded + '&filter=music_artists').catch(() => null)
    ]);

    const tracks = (songsData && songsData.items ? songsData.items : [])
      .map(mapStreamItem).filter(Boolean);
    const albums = (albumsData && albumsData.items ? albumsData.items : [])
      .map(mapPlaylistItem).filter(Boolean);
    const artists = (artistsData && artistsData.items ? artistsData.items : [])
      .map(mapChannelItem).filter(Boolean);

    return { tracks: tracks, albums: albums, artists: artists, playlists: [] };
  },

  async getAlbums() {
    return [];
  },

  async getAlbumTracks(id) {
    const data = await pipedGet('/playlists/' + id);
    if (!data || !data.relatedStreams) return [];

    return data.relatedStreams.map((item, idx) => {
      const track = mapStreamItem(item);
      if (track) {
        track.albumId = id;
        track.album = data.name || '';
        track.trackNumber = idx + 1;
        // Use playlist thumbnail if track doesn't have one
        if (!track.cover && data.thumbnailUrl) {
          track.cover = getBestThumbnail(data.thumbnailUrl);
        }
      }
      return track;
    }).filter(Boolean);
  },

  async getArtists() {
    return [];
  },

  async getArtistAlbums(id) {
    // Piped doesn't have a direct "artist albums" endpoint
    // Search for the artist name with music_albums filter
    const data = await pipedGet('/channel/' + id);
    if (!data || !data.name) return [];

    const searchData = await pipedGet('/search?q=' + encodeURIComponent(data.name) + '&filter=music_albums');
    if (!searchData || !searchData.items) return [];

    return searchData.items.map(mapPlaylistItem).filter(Boolean);
  },

  async getArtistTopTracks(id) {
    const data = await pipedGet('/channel/' + id);
    if (!data || !data.name) return [];

    const searchData = await pipedGet('/search?q=' + encodeURIComponent(data.name) + '&filter=music_songs');
    if (!searchData || !searchData.items) return [];

    return searchData.items.slice(0, 20).map(mapStreamItem).filter(Boolean);
  },

  async getStreamUrl(trackId, quality) {
    const data = await pipedGet('/streams/' + trackId);

    if (!data || !data.audioStreams || data.audioStreams.length === 0) {
      throw new Error('No audio streams available');
    }

    // Sort by bitrate descending
    const sorted = data.audioStreams.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

    // Prefer M4A (AAC) for iOS AVPlayer compatibility, then Opus
    const m4a = sorted.find(s => s.format === 'M4A' || (s.mimeType && s.mimeType.includes('audio/mp4')));
    const opus = sorted.find(s => s.format === 'WEBMA_OPUS' || (s.mimeType && s.mimeType.includes('audio/webm')));

    // iOS AVPlayer handles M4A natively, Opus needs container support
    const best = m4a || opus || sorted[0];

    if (!best || !best.url) {
      throw new Error('No playable audio stream found');
    }

    return {
      url: best.url,
      format: 'directUrl',
      quality: (best.bitrate || 0) > 100000 ? 'HIGH' : 'LOW'
    };
  },

  async getLyrics(trackId, title, artist, album, duration) {
    // Try LRCLIB
    const params = 'track_name=' + encodeURIComponent(title) +
      '&artist_name=' + encodeURIComponent(artist) +
      (duration > 0 ? '&duration=' + Math.round(duration) : '');
    try {
      const res = await http.get('https://lrclib.net/api/get?' + params);
      if (res.status === 200 && res.data && (res.data.syncedLyrics || res.data.plainLyrics)) {
        return { synced: res.data.syncedLyrics || null, plain: res.data.plainLyrics || null };
      }
    } catch (e) {}

    throw new Error('No lyrics found');
  },

  async getCoverArt(albumId) {
    return '';
  },

  async getFeatured() {
    // Search for trending/popular music
    try {
      const data = await pipedGet('/search?q=top%20hits%202026&filter=music_albums');
      if (data && data.items) {
        return data.items.slice(0, 15).map(mapPlaylistItem).filter(Boolean);
      }
    } catch (e) {}
    return [];
  }
};
