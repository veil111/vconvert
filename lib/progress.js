// One-line progress bar: label, bar, percent, size, speed and time left.

const { formatBytes, formatDuration, truncate } = require('./util');

const STAGES = {
  Merger: 'Merging video + audio',
  ExtractAudio: 'Converting audio',
  EmbedThumbnail: 'Adding cover art',
  FFmpegMetadata: 'Adding details',
  VideoRemuxer: 'Finishing video',
  VideoConvertor: 'Converting video',
  ThumbnailsConvertor: 'Saving thumbnail',
};

const REDRAW_MS = 100; // yt-dlp reports many times a second; the terminal only needs ~10 redraws
const BAR_WIDTH = 24; // characters

class Progress {
  constructor(label) {
    this.label = label;
    this.tty = Boolean(process.stdout.isTTY);
    this.lastPct = -1;
    this.lastDraw = 0;
    this.drawn = false;
  }

  // `part` is "video"/"audio" when a video is downloaded as two streams.
  update({ downloaded, total, speed, eta, part }) {
    const pct = total ? Math.min(100, (downloaded / total) * 100) : null;
    const now = Date.now();
    if (this.tty && pct !== 100 && now - this.lastDraw < REDRAW_MS) return;
    this.lastDraw = now;
    if (!eta && speed && total) eta = (total - downloaded) / speed;
    const filled = pct === null ? 0 : Math.round((pct / 100) * BAR_WIDTH);
    const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
    const fields = [
      `${this.label}${part ? ` (${part})` : ''}`,
      bar,
      pct === null ? ' ...' : `${pct.toFixed(0).padStart(3)}%`,
      total ? `${formatBytes(downloaded)} / ${formatBytes(total)}` : formatBytes(downloaded),
      speed ? `${formatBytes(speed)}/s` : '',
      eta ? `${formatDuration(eta)} left` : '',
    ].filter(Boolean);
    if (this.tty) {
      this.draw(fields.join('  '));
    } else if (pct !== null && Math.floor(pct / 25) > Math.floor(this.lastPct / 25)) {
      console.log(`  ${fields.join('  ')}`); // no live terminal (e.g. piped): print every 25%
    }
    if (pct !== null) this.lastPct = pct;
  }

  stage(postprocessor) {
    const text = STAGES[postprocessor];
    if (!text) return;
    if (this.tty) this.draw(`${this.label}  ${text}...`);
    else console.log(`  ${this.label}  ${text}...`);
  }

  draw(line) {
    const cols = process.stdout.columns || 100;
    process.stdout.write(`\r  ${truncate(line, cols - 3)}\x1b[K`);
    this.drawn = true;
  }

  // Leaves the last line on screen and moves to the next line.
  finish(message) {
    if (this.tty && this.drawn) process.stdout.write('\r\x1b[K');
    if (message) console.log(`  ${message}`);
  }
}

module.exports = { Progress };
