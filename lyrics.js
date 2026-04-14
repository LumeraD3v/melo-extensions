// @manifest {"id":"lyrics","name":"Lyrics (Multi-Source)","version":"1.0","author":"Melo","description":"Synced lyrics from LRCLIB, Spotify, Musixmatch, Apple Music, NetEase, QQ Music","capabilities":{"rawValue":8}}

// Lyrics cascade extension — based on SpotiFLAC (go_backend/lyrics*.go).
// Tries multiple sources in order until one succeeds.
// All Paxsenix proxy endpoints from SpotiFLAC's lyrics provider files.

const LRCLIB_URL = 'https://lrclib.net';
const PAXSENIX_URL = 'https://lyrics.paxsenix.org';

// Normalize query for better matching (from SpotiFLAC lyrics.go)
function simplifyName(name) {
  return name
    .replace(/\s*\(feat\..*?\)/gi, '')
    .replace(/\s*\(ft\..*?\)/gi, '')
    .replace(/\s*\[.*?\]/g, '')
    .replace(/\s*\(.*?remix.*?\)/gi, '')
    .replace(/\s*\(.*?version.*?\)/gi, '')
    .trim();
}

// 1. LRCLIB (from SpotiFLAC lyrics.go)
async function tryLRCLIB(title, artist, album, duration) {
  const params = 'track_name=' + encodeURIComponent(title) +
    '&artist_name=' + encodeURIComponent(artist) +
    (album ? '&album_name=' + encodeURIComponent(album) : '') +
    (duration > 0 ? '&duration=' + Math.round(duration) : '');

  const res = await http.get(LRCLIB_URL + '/api/get?' + params);
  if (res.status === 200 && res.data) {
    if (res.data.syncedLyrics || res.data.plainLyrics) {
      return { synced: res.data.syncedLyrics || null, plain: res.data.plainLyrics || null };
    }
  }

  // Fallback to search (from SpotiFLAC lyrics.go)
  const searchRes = await http.get(LRCLIB_URL + '/api/search?q=' + encodeURIComponent(title + ' ' + artist));
  if (searchRes.status === 200 && searchRes.data && searchRes.data.length > 0) {
    const best = searchRes.data[0];
    if (best.syncedLyrics || best.plainLyrics) {
      return { synced: best.syncedLyrics || null, plain: best.plainLyrics || null };
    }
  }
  return null;
}

// 2. Spotify Lyrics via Paxsenix (from SpotiFLAC lyrics.go)
async function trySpotifyLyrics(title, artist) {
  // We need a Spotify ID — search Paxsenix doesn't need one, but the endpoint does
  // Skip if no way to get Spotify ID
  return null;
}

// 3. Musixmatch via Paxsenix (from SpotiFLAC lyrics_musixmatch.go)
async function tryMusixmatch(title, artist, duration) {
  const params = 't=' + encodeURIComponent(simplifyName(title)) +
    '&a=' + encodeURIComponent(simplifyName(artist)) +
    '&type=word&format=lrc' +
    (duration > 0 ? '&d=' + Math.round(duration) : '');

  const res = await http.get(PAXSENIX_URL + '/musixmatch/lyrics?' + params);
  if (res.status === 200 && res.data) {
    // Response is a JSON string containing LRC
    const lrc = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    if (lrc && lrc.includes('[')) {
      return { synced: lrc, plain: null };
    }
  }
  return null;
}

// 4. NetEase via Paxsenix (from SpotiFLAC lyrics_netease.go)
async function tryNetease(title, artist) {
  const query = simplifyName(title) + ' ' + simplifyName(artist);
  const searchRes = await http.get(PAXSENIX_URL + '/netease/search?q=' + encodeURIComponent(query));

  if (searchRes.status !== 200 || !searchRes.data) return null;

  // Find best match from search results
  let songId = null;
  if (Array.isArray(searchRes.data)) {
    songId = searchRes.data[0] && searchRes.data[0].id ? String(searchRes.data[0].id) : null;
  } else if (searchRes.data.result && searchRes.data.result.songs) {
    songId = String(searchRes.data.result.songs[0].id);
  } else if (searchRes.data.id) {
    songId = String(searchRes.data.id);
  }

  if (!songId) return null;

  const lyricsRes = await http.get(PAXSENIX_URL + '/netease/lyrics?id=' + songId);
  if (lyricsRes.status === 200 && lyricsRes.data) {
    const d = lyricsRes.data;
    // NetEase returns {lrc:{lyric:"..."}, tlyric:{lyric:"..."}}
    const lrc = d.lrc ? d.lrc.lyric : null;
    if (lrc && lrc.includes('[')) {
      return { synced: lrc, plain: null };
    }
  }
  return null;
}

// 5. Apple Music via Paxsenix (from SpotiFLAC lyrics_apple.go)
async function tryAppleMusic(title, artist) {
  const query = simplifyName(title) + ' ' + simplifyName(artist);
  const searchRes = await http.get(PAXSENIX_URL + '/apple-music/search?q=' + encodeURIComponent(query));

  if (searchRes.status !== 200 || !searchRes.data) return null;

  let songId = null;
  if (Array.isArray(searchRes.data) && searchRes.data[0]) {
    songId = String(searchRes.data[0].id || searchRes.data[0]);
  } else if (searchRes.data.id) {
    songId = String(searchRes.data.id);
  }

  if (!songId) return null;

  const lyricsRes = await http.get(PAXSENIX_URL + '/apple-music/lyrics?id=' + songId);
  if (lyricsRes.status === 200 && lyricsRes.data) {
    const d = lyricsRes.data;
    // Can be LRC string or PAX format (word-by-word)
    if (typeof d === 'string' && d.includes('[')) {
      return { synced: d, plain: null };
    }
    // PAX format: convert to LRC
    if (d.content && Array.isArray(d.content)) {
      let lrc = '';
      for (const line of d.content) {
        if (line.timestamp !== undefined && line.text) {
          const ts = line.timestamp / 1000;
          const min = Math.floor(ts / 60);
          const sec = ts % 60;
          const text = Array.isArray(line.text) ? line.text.map(w => w.text).join('') : String(line.text);
          lrc += '[' + String(min).padStart(2, '0') + ':' + sec.toFixed(2).padStart(5, '0') + ']' + text + '\n';
        }
      }
      if (lrc) return { synced: lrc, plain: null };
    }
  }
  return null;
}

// 6. QQ Music via Paxsenix (from SpotiFLAC lyrics_qqmusic.go)
async function tryQQMusic(title, artist, duration) {
  const payload = {
    artist: [simplifyName(artist)],
    title: simplifyName(title),
    duration: Math.round(duration || 0)
  };

  const res = await http.post(PAXSENIX_URL + '/qq/lyrics-metadata', payload, {
    'Content-Type': 'application/json'
  });

  if (res.status === 200 && res.data && res.data.lyrics && Array.isArray(res.data.lyrics)) {
    // Convert PAX format to LRC
    let lrc = '';
    for (const line of res.data.lyrics) {
      if (line.timestamp !== undefined && line.text) {
        const ts = line.timestamp / 1000;
        const min = Math.floor(ts / 60);
        const sec = ts % 60;
        const text = Array.isArray(line.text) ? line.text.map(w => w.text).join('') : String(line.text);
        lrc += '[' + String(min).padStart(2, '0') + ':' + sec.toFixed(2).padStart(5, '0') + ']' + text + '\n';
      }
    }
    if (lrc) return { synced: lrc, plain: null };
  }
  return null;
}

const extension = {
  async getLyrics(trackId, title, artist, album, duration) {
    // Cascade through all sources (same order as SpotiFLAC lyrics.go)
    const providers = [
      () => tryLRCLIB(title, artist, album, duration),
      () => tryMusixmatch(title, artist, duration),
      () => tryNetease(title, artist),
      () => tryAppleMusic(title, artist),
      () => tryQQMusic(title, artist, duration)
    ];

    for (const provider of providers) {
      try {
        const result = await provider();
        if (result && (result.synced || result.plain)) return result;
      } catch (e) {
        // Continue to next provider
      }
    }

    throw new Error('No lyrics found from any source');
  }
};
