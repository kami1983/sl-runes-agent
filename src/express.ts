import express, { Express, Request, Response } from "express";
// import { slCallback } from "./apps/rbot/slbot";
// import { slBotCallback } from "./apps"
import { slCallback as slBotCallback } from "./apps/rbot/slbot";

console.log('process.env.NODE_ENV = ', process.env.NODE_ENV);
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const app: Express = express();

app.get('/healthz', (req: Request, res: Response) => {
  res.send('OK');
});

// apps
app.use(slBotCallback);

app.listen(3001, '0.0.0.0', () => {
  console.log('[server]: Server is running at http://0.0.0.0:3001');
});

// npx ts-node ./src/express.ts
