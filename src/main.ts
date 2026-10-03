import { Issuer } from './crypto.ts';
import { LocalLedger } from './ledger.ts';
import { createWitnessServer } from './server.ts';
import { Witness } from './service.ts';

const port = Number(process.env.PORT ?? 3000);
const ledger = new LocalLedger(process.env.WITNESS_LEDGER_FILE ?? null);
const witness = new Witness({
  publisher: ledger,
  issuer: new Issuer(process.env.WITNESS_ISSUER_KEY?.replace(/\\n/g, '\n')),
});
const server = createWitnessServer(witness, {
  apiKey: process.env.WITNESS_API_KEY,
  adminKey: process.env.WITNESS_ADMIN_KEY,
  simSpeed: Number(process.env.WITNESS_SIM_SPEED ?? 10),
});

server.listen(port, () => {
  console.log(`Witness listening on http://localhost:${port}`);
  if (!process.env.WITNESS_API_KEY) console.log('Development mode: no API key set, write endpoints are open.');
  if (!process.env.WITNESS_ISSUER_KEY) console.log('Using a throwaway issuer key; set WITNESS_ISSUER_KEY to keep signatures verifiable across restarts.');
});
