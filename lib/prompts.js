// Terminal questions. Every method resolves with null (or undefined for choose) once input has
// ended (Ctrl+C / Ctrl+D), so callers can exit cleanly.

const readline = require('readline');
const { formatBytes } = require('./util');

const PASTE_WAIT_MS = 150; // lines of one paste arrive within this time of each other

class Prompter {
  constructor() {
    this.rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    this.closed = false;
    this.onClosed = null;
    this.rl.on('close', () => {
      this.closed = true;
      if (this.onClosed) this.onClosed();
    });
  }

  ask(question) {
    return new Promise((resolve) => {
      if (this.closed) return resolve(null);
      this.onClosed = () => resolve(null);
      this.rl.question(question, (answer) => {
        this.onClosed = null;
        resolve(answer.trim());
      });
    });
  }

  // Like ask, but also collects the rest of a multi-line paste. Resolves with an array of lines.
  askLines(prompt) {
    return new Promise((resolve) => {
      if (this.closed) return resolve(null);
      const lines = [];
      let timer = null;
      const done = (result) => {
        clearTimeout(timer);
        this.rl.off('line', onLine);
        this.onClosed = null;
        resolve(result);
      };
      const onLine = (line) => {
        lines.push(line);
        clearTimeout(timer);
        timer = setTimeout(() => done(lines), PASTE_WAIT_MS);
      };
      this.onClosed = () => done(lines.length ? lines : null);
      this.rl.on('line', onLine);
      this.rl.setPrompt(prompt);
      this.rl.prompt();
    });
  }

  // Returns true/false, or null if input ended.
  async yesNo(question, defaultYes) {
    const answer = await this.ask(`${question} ${defaultYes ? '[Y/n]' : '[y/N]'}: `);
    if (answer === null) return null;
    if (!answer) return defaultYes;
    return /^y(es)?$/i.test(answer);
  }

  // Numbered list of { label, note?, size? }. Returns the chosen item, or undefined if input ended.
  async choose(title, items, defaultIndex = 0) {
    console.log(`\n${title}`);
    const width = Math.max(...items.map((it) => it.label.length));
    const showSizes = items.some((it) => it.size !== undefined);
    items.forEach((it, i) => {
      const size = showSizes ? `  ${it.size ? `~${formatBytes(it.size)}` : ''}`.padEnd(13) : '';
      console.log(`  [${i + 1}] ${it.label.padEnd(width)}${size}${it.note ? `  (${it.note})` : ''}`.trimEnd());
    });
    for (;;) {
      const answer = await this.ask(`Choose [Enter = ${defaultIndex + 1}]: `);
      if (answer === null) return undefined;
      if (!answer) return items[defaultIndex];
      const n = parseInt(answer, 10);
      if (n >= 1 && n <= items.length) return items[n - 1];
      console.log(`Pick a number from 1 to ${items.length}.`);
    }
  }

  close() {
    this.rl.close();
  }
}

module.exports = { Prompter };
