// 假上游：模拟 MiMo chat/completions 的 JSON 与 SSE(pcm16) 两种返回，用于本地端到端验证。
import { createServer } from 'node:http';

const PORT = Number(process.env.FAKE_PORT || 9099);
const SR = 24000;

function pcm(seconds, freq) {
  const n = Math.floor(SR * seconds), b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const s = Math.round(Math.sin((2 * Math.PI * freq * i) / SR) * 12000);
    b.writeInt16LE(s, i * 2);
  }
  return b;
}
function wav(pcmBuf) {
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + pcmBuf.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(SR, 24); head.writeUInt32LE(SR * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(pcmBuf.length, 40);
  return Buffer.concat([head, pcmBuf]);
}

createServer((req, res) => {
  let raw = '';
  req.on('data', c => (raw += c));
  req.on('end', () => {
    const auth = req.headers.authorization || '';
    if (auth !== 'Bearer test-server-key' && auth !== 'Bearer sk-visitor-key') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
      return;
    }
    const body = JSON.parse(raw || '{}');
    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const parts = [pcm(0.5, 220), pcm(0.5, 330), pcm(0.5, 440)];
      parts.forEach((p, i) => {
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { audio: { data: p.toString('base64') } } }] }) + '\n\n');
        if (i === parts.length - 1) res.write('data: [DONE]\n\n');
      });
      res.end();
      return;
    }
    const audio = body.audio || {};
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { audio: { data: wav(pcm(0.8, 300)).toString('base64') } } }],
      echo: { model: body.model, messages: body.messages, voice: String(audio.voice || '').slice(0, 48), format: audio.format }
    }));
  });
}).listen(PORT, '127.0.0.1', () => console.log('fake upstream → http://127.0.0.1:' + PORT + '/v1'));
