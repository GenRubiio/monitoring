import { Client } from 'ssh2';
import { parseFreeBytes, parseProcStat } from '../src/main/parsers';

// Gated integration test. Runs only when SSH_INTEGRATION is set and the target
// server (192.168.100.56, ubuntu/ubuntu) is reachable.
const RUN = !!process.env.SSH_INTEGRATION;
const HOST = process.env.SSH_HOST ?? '192.168.100.56';
const USER = process.env.SSH_USER ?? 'ubuntu';
const PASS = process.env.SSH_PASS ?? 'ubuntu';

const describeOrSkip = RUN ? describe : describe.skip;

function exec(client: Client, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      stream
        .on('close', () => resolve(out))
        .on('data', (d: Buffer) => {
          out += d.toString('utf8');
        });
    });
  });
}

describeOrSkip('SSH integration (gated by SSH_INTEGRATION)', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client();
    await new Promise<void>((resolve, reject) => {
      client.on('ready', resolve);
      client.on('error', reject);
      client.connect({
        host: HOST,
        port: 22,
        username: USER,
        password: PASS,
        readyTimeout: 10000,
      });
    });
  }, 20000);

  afterAll(() => {
    if (client) client.end();
  });

  it('connects and reads valid RAM via free -b', async () => {
    const out = await exec(client, 'free -b');
    const { total, used } = parseFreeBytes(out);
    expect(total).toBeGreaterThan(0);
    expect(used).toBeGreaterThan(0);
    expect(used).toBeLessThanOrEqual(total);
  });

  it('connects and computes CPU load via /proc/stat', async () => {
    const s1 = await exec(client, 'cat /proc/stat');
    await new Promise((r) => setTimeout(r, 250));
    const s2 = await exec(client, 'cat /proc/stat');
    const cpu = parseProcStat(s1, s2);
    expect(cpu).toBeGreaterThanOrEqual(0);
    expect(cpu).toBeLessThanOrEqual(100);
  });
});
