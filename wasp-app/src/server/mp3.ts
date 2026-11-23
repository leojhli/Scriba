// Joins mp3 clips from ElevenLabs into one file. Each clip starts with an ID3 tag and a
// Xing/Info frame that describes only that clip; left in, the browser would take the first
// clip's length for the whole file. Both are dropped, leaving one plain CBR frame stream.

const BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]; // MPEG-1 Layer III, kbps
const RATES = [44100, 48000, 32000];

function skipId3(b: Buffer): number {
  if (b.length < 10 || b.toString("latin1", 0, 3) !== "ID3") return 0;
  const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
  return 10 + size + (b[5] & 0x10 ? 10 : 0);
}

/** Byte length of the MPEG-1 Layer III frame at `at`, or 0 if there isn't one. */
function frameLength(b: Buffer, at: number): number {
  if (at + 4 > b.length || b[at] !== 0xff || (b[at + 1] & 0xfe) !== 0xfa) return 0;
  const bitrate = BITRATES[b[at + 2] >> 4];
  const rate = RATES[(b[at + 2] >> 2) & 3];
  if (!bitrate || !rate) return 0;
  return Math.floor((144 * bitrate * 1000) / rate) + ((b[at + 2] >> 1) & 1);
}

/** The audio frames of one clip, without its ID3 tag and Xing/Info header frame. */
export function audioFrames(b: Buffer): Buffer {
  let at = skipId3(b);
  const len = frameLength(b, at);
  if (len) {
    const head = b.toString("latin1", at, at + len);
    if (head.includes("Xing") || head.includes("Info")) at += len;
  }
  return b.subarray(at);
}

export function joinMp3(clips: Buffer[]): Buffer {
  return clips.length === 1 ? clips[0] : Buffer.concat(clips.map(audioFrames));
}
