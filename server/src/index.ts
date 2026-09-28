import 'dotenv/config';
import { startServer, stopServer } from './server';

void startServer().then((server) => {
  const shutdown = async (): Promise<void> => {
    await stopServer(server);
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
});
