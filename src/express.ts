import express, { Express, Request, Response, NextFunction } from "express";
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

var bodyParser = require('body-parser');
app.use(bodyParser());

// apps
// app.use(slBotCallback);
app.use(async (req: Request, res: Response, next: NextFunction) => {
  try {
    await slBotCallback(req, res, next);
  } catch (error) {
    console.error('Error in slBotCallback:', error);
    res.status(500).send('Something went wrong.');
  }
});



app.listen(3001, '0.0.0.0', () => {
  console.log('[server]: Server is running at http://0.0.0.0:3001');
});

// npx ts-node ./src/express.ts
