// Pure Node.js HLS manifest parser and rewriter.
// - Filters variant streams (#EXT-X-STREAM-INF) by audio codec support
// - Filters alternative audio tracks (#EXT-X-MEDIA with TYPE=AUDIO) by codec
// - Rewrites segment URLs to point through the sidecar proxy
//
// No external dependencies — uses only Node.js built-ins.

const UNSUPPORTED_AUDIO_CODECS = new Set(["ec-3", "ac-3", "dts", "truehd"]);

function parseCodecs(codecsStr) {
  if (!codecsStr) return [];
  return codecsStr.split(",").map((c) => c.trim()).filter(Boolean);
}

function codecsToKeep(codecs) {
  return codecs.filter((c) => !UNSUPPORTED_AUDIO_CODECS.has(c.toLowerCase()));
}

function buildCodecsAttr(keepCodecs) {
  return keepCodecs.join(",");
}

function isAudioTrack(line) {
  return line.includes("#EXT-X-MEDIA:") && line.includes('TYPE="AUDIO"');
}

function isVariantStream(line) {
  return line.includes("#EXT-X-STREAM-INF:");
}

function getAttr(line, name) {
  const re = new RegExp(`${name}="([^"]*)"`, "i");
  const m = line.match(re);
  return m ? m[1] : null;
}

function extractGroupId(line) {
  return getAttr(line, "GROUP-ID");
}

export function rewriteManifest(manifestText, baseUrl, proxySegmentUrl) {
  const lines = manifestText.split(/\r?\n/);
  const out = [];

  // Track which audio GROUP-IDs we've removed so we can drop them from variant streams
  const removedAudioGroups = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // ── Variant stream: #EXT-X-STREAM-INF ──────────────────────────────
    if (isVariantStream(line)) {
      const codecs = getAttr(line, "CODECS");
      if (codecs) {
        const parsed = parseCodecs(codecs);
        const kept = codecsToKeep(parsed);
        if (kept.length === 0) {
          // No supported codecs — skip this entire stream variant
          // consume the next line (URL) and continue
          i++; // skip the URL line
          continue;
        }
        if (kept.length < parsed.length) {
          // Replace CODECS attribute with only supported codecs
          const newLine = line.replace(/CODECS="[^"]*"/, `CODECS="${buildCodecsAttr(kept)}"`);
          // Also remove AUDIO attribute if that group was removed
          const audioGroup = getAttr(line, "AUDIO");
          if (audioGroup && removedAudioGroups.has(audioGroup)) {
            out.push(newLine.replace(/\s+AUDIO="[^"]*"/, ""));
          } else {
            out.push(newLine);
          }
          out.push(lines[++i].trim());
          continue;
        }
      }
      out.push(line);
      out.push(lines[++i].trim());
      continue;
    }

    // ── Audio track: #EXT-X-MEDIA TYPE=AUDIO ─────────────────────────────
    if (isAudioTrack(line)) {
      const codecs = getAttr(line, "CODECS");
      if (codecs) {
        const parsed = parseCodecs(codecs);
        const kept = codecsToKeep(parsed);
        if (kept.length === 0) {
          // Skip this audio track
          const groupId = extractGroupId(line);
          if (groupId) removedAudioGroups.add(groupId);
          continue;
        }
      }
      out.push(line);
      continue;
    }

    // ── Segment URL rewrite ─────────────────────────────────────────────
    if (line && !line.startsWith("#") && (line.endsWith(".ts") || line.endsWith(".m4s") || line.endsWith(".aac") || line.endsWith(".mp3") || line.endsWith(".webm"))) {
      const absoluteUrl = new URL(line, baseUrl).href;
      out.push(proxySegmentUrl(encodeURIComponent(absoluteUrl)));
      continue;
    }

    // ── Everything else: pass through ────────────────────────────────────
    out.push(line);
  }

  return out.join("\n");
}

export function parseManifestForAudioCodecs(manifestText) {
  const lines = manifestText.split(/\r?\n/);
  const audioTracks = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (isAudioTrack(trimmed)) {
      const codecs = getAttr(trimmed, "CODECS");
      const name = getAttr(trimmed, "NAME") || getAttr(trimmed, "group-id") || "unknown";
      const groupId = extractGroupId(trimmed);
      audioTracks.push({
        name,
        groupId,
        codecs: codecs ? parseCodecs(codecs) : [],
        line: trimmed,
      });
    }
  }

  return audioTracks;
}

export function hasUnsupportedAudioCodecs(manifestText) {
  const tracks = parseManifestForAudioCodecs(manifestText);
  return tracks.some((t) => t.codecs.some((c) => UNSUPPORTED_AUDIO_CODECS.has(c.toLowerCase())));
}