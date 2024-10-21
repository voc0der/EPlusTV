import {Context, Hono} from 'hono';
import {serve} from '@hono/node-server';
import {serveStatic} from '@hono/node-server/serve-static';
import {BlankEnv, BlankInput} from 'hono/types';
import {html} from 'hono/html';
import moment from 'moment';

import {generateM3u} from './services/generate-m3u';
import {initDirectories} from './services/init-directories';
import {generateXml} from './services/generate-xmltv';
import {launchChannel} from './services/launch-channel';
import {scheduleEntries} from './services/build-schedule';
import {espnHandler} from './services/espn-handler';
import {foxHandler} from './services/fox-handler';
import {mlbHandler} from './services/mlb-handler';
import {b1gHandler} from './services/b1g-handler';
import {floSportsHandler} from './services/flo-handler';
import {paramountHandler} from './services/paramount-handler';
import {nflHandler} from './services/nfl-handler';
import {msgHandler} from './services/msg-handler';
import {mwHandler} from './services/mw-handler';
import {nesnHandler} from './services/nesn-handler';
import {cbsHandler} from './services/cbs-handler';
import {cleanEntries, clearChannels, removeAllEntries, removeChannelStatus} from './services/shared-helpers';
import {appStatus} from './services/app-status';
import {SERVER_PORT} from './services/port';
import {useLinear} from './services/channels';
import { providers } from './services/providers';

import {version} from './package.json';

import { Layout } from './views/Layout';
import { Header } from './views/Header';
import { Main } from './views/Main';
import { Links } from './views/Links';
import { Style } from './views/Style';
import { Providers } from './views/Providers';
import { Script } from './views/Script';
import {Tools} from './views/Tools';

import {CBSSports} from './services/providers/cbs-sports/views';
import { MntWest } from './services/providers/mw/views';
import {Paramount} from './services/providers/paramount/views';
import {FloSports} from './services/providers/flosports/views';
import {MlbTv} from './services/providers/mlb/views';
import {FoxSports} from './services/providers/fox/views';
import {Nesn} from './services/providers/nesn/views';
import {B1G} from './services/providers/b1g/views';
import {NFL} from './services/providers/nfl/views';
import {ESPN} from './services/providers/espn/views';
import {ESPNPlus} from './services/providers/espn-plus/views';

const notFound = (c: Context<BlankEnv, '', BlankInput>) => {
  return c.text('404 not found', 404, {
    'X-Tuner-Error': 'EPlusTV: Error getting content',
  });
};

const shutDown = () => process.exit(0);

const getUri = (c: Context<BlankEnv, '', BlankInput>): string => {
  if (process.env.BASE_URL) {
    return process.env.BASE_URL;
  }

  const protocol = c.req.header('x-forwarded-proto') || 'http';
  const host = c.req.header('host') || '';

  return `${protocol}://${host}`;
};

const schedule = async () => {
  console.log('=== Getting events ===');

  await espnHandler.getSchedule();
  await foxHandler.getSchedule();
  await mlbHandler.getSchedule();
  await b1gHandler.getSchedule();
  await floSportsHandler.getSchedule();
  await mwHandler.getSchedule();
  await nflHandler.getSchedule();
  await paramountHandler.getSchedule();
  await msgHandler.getSchedule();
  await nesnHandler.getSchedule();
  await cbsHandler.getSchedule();

  console.log('=== Done getting events ===');
  console.log('=== Building the schedule ===');

  await cleanEntries();
  await scheduleEntries();

  console.log('=== Done building the schedule ===');
};

const app = new Hono();

app.use('/node_modules/*', serveStatic({root: './'}));
app.use('/favicon.ico', serveStatic({root: './'}));

app.route('/', providers);

app.get('/', async c => {
  return c.html(
    html`<!DOCTYPE html>${(
      <Layout>
        <Header />
        <Main>
          <Links baseUrl={getUri(c)} />
          <Tools />
          <Providers>
            <ESPNPlus />
            <NFL />
            <MlbTv />
            <FoxSports />
            <CBSSports />
            <ESPN />
            <Paramount />
            <Nesn />
            <B1G />
            <FloSports />
            <MntWest />
          </Providers>
        </Main>
        <Style />
        <Script />
      </Layout>
    )}`,
  );
});

app.post('/rebuild-epg', async c => {
  await removeAllEntries();
  await schedule();

  return c.html(<Tools />, 200, {
    'HX-Trigger': `{"HXToast":{"type":"success","body":"Successfully rebuilt EPG"}}`,
  });
});

app.post('/reset-channels', async c => {
  clearChannels();

  return c.html(<Tools />, 200, {
    'HX-Trigger': `{"HXToast":{"type":"success","body":"Successfully cleared channels"}}`,
  });
});

app.get('/channels.m3u', async c => {
  const m3uFile = await generateM3u(getUri(c));

  if (!m3uFile) {
    return notFound(c);
  }

  return c.body(m3uFile, 200, {
    'Content-Type': 'application/x-mpegurl',
  });
});

app.get('/linear-channels.m3u', async c => {
  if (!useLinear) {
    return notFound(c);
  }

  const m3uFile = await generateM3u(getUri(c), true);

  if (!m3uFile) {
    return notFound(c);
  }

  return c.body(m3uFile, 200, {
    'Content-Type': 'application/x-mpegurl',
  });
});

app.get('/xmltv.xml', async c => {
  const xmlFile = await generateXml();

  if (!xmlFile) {
    return notFound(c);
  }

  return c.body(xmlFile, 200, {
    'Content-Type': 'application/xml',
  });
});

app.get('/linear-xmltv.xml', async c => {
  if (!useLinear) {
    return notFound(c);
  }

  const xmlFile = await generateXml(true);

  if (!xmlFile) {
    return notFound(c);
  }

  return c.body(xmlFile, 200, {
    'Content-Type': 'application/xml',
  });
});

app.get('/channels/:id{.+\\.m3u8$}', async c => {
  const id = c.req.param('id').split('.m3u8')[0];

  let contents: string | undefined;

  // Channel data needs initial object
  if (!appStatus.channels[id]) {
    appStatus.channels[id] = {};
  }

  const uri = getUri(c);

  if (!appStatus.channels[id].player?.playlist) {
    try {
      await launchChannel(id, uri);
    } catch (e) {}
  }

  try {
    contents = appStatus.channels[id].player?.playlist;
  } catch (e) {}

  if (!contents) {
    console.log(
      `Could not get a playlist for channel #${id}. Please make sure there is an event scheduled and you have access to it.`,
    );

    removeChannelStatus(id);

    return notFound(c);
  }

  appStatus.channels[id].heartbeat = new Date();

  return c.body(contents, 200, {
    'Cache-Control': 'no-cache',
    'Content-Type': 'application/vnd.apple.mpegurl',
  });
});

app.get('/chunklist/:id/:chunklistid{.+\\.m3u8$}', async c => {
  const id = c.req.param('id');
  const chunklistid = c.req.param('chunklistid').split('.m3u8')[0];

  let contents: string | undefined;

  if (!appStatus.channels[id]?.player?.playlist) {
    return notFound(c);
  }

  try {
    contents = await appStatus.channels[id].player.cacheChunklist(chunklistid);
  } catch (e) {}

  if (!contents) {
    console.log(`Could not get chunklist for channel #${id}.`);
    removeChannelStatus(id);
    return notFound(c);
  }

  appStatus.channels[id].heartbeat = new Date();

  return c.body(contents, 200, {
    'Cache-Control': 'no-cache',
    'Content-Type': 'application/vnd.apple.mpegurl',
  });
});

app.get('/channels/:id/:part{.+\\.key$}', async c => {
  const id = c.req.param('id');
  const part = c.req.param('part').split('.key')[0];

  let contents: ArrayBuffer | undefined;

  try {
    contents = await appStatus.channels[id].player?.getSegmentOrKey(part);
  } catch (e) {
    return notFound(c);
  }

  if (!contents) {
    return notFound(c);
  }

  appStatus.channels[id].heartbeat = new Date();

  return c.body(contents, 200, {
    'Cache-Control': 'no-cache',
    'Content-Type': 'application/octet-stream',
  });
});

app.get('/channels/:id/:part{.+\\.ts$}', async c => {
  const id = c.req.param('id');
  const part = c.req.param('part').split('.ts')[0];

  let contents: ArrayBuffer | undefined;

  try {
    contents = await appStatus.channels[id].player?.getSegmentOrKey(part);
  } catch (e) {
    return notFound(c);
  }

  if (!contents) {
    return notFound(c);
  }

  return c.body(contents, 200, {
    'Cache-Control': 'no-cache',
    'Content-Type': 'video/MP2T',
  });
});

// 404 Handler
app.notFound(notFound);

process.on('SIGTERM', shutDown);
process.on('SIGINT', shutDown);

(async () => {
  console.log(`=== E+TV v${version} starting ===`);
  initDirectories();

  await espnHandler.initialize();
  await espnHandler.refreshTokens();

  await foxHandler.initialize();
  await foxHandler.refreshTokens();

  await mlbHandler.initialize();
  await mlbHandler.refreshTokens();

  await b1gHandler.initialize();
  await b1gHandler.refreshTokens();

  await floSportsHandler.initialize();
  await floSportsHandler.refreshTokens();

  await nflHandler.initialize();
  await nflHandler.refreshTokens();

  await paramountHandler.initialize();
  await paramountHandler.refreshTokens();

  await msgHandler.initialize();
  await msgHandler.refreshTokens();

  await nesnHandler.initialize();
  await nesnHandler.refreshTokens();

  await cbsHandler.initialize();
  await cbsHandler.refreshTokens();

  await mwHandler.initialize();

  serve(
    {
      fetch: app.fetch,
      port: SERVER_PORT,
    },
    () => {
      console.log(`Server started on port ${SERVER_PORT}`);
      schedule();
    },
  );
})();

// Check for events every 4 hours and set the schedule
setInterval(async () => {
  await schedule();
}, 1000 * 60 * 60 * 4);

// Check for updated refresh tokens 30 minutes
setInterval(async () => {
  await espnHandler.refreshTokens();
  await foxHandler.refreshTokens();
  await mlbHandler.refreshTokens();
  await b1gHandler.refreshTokens();
  await floSportsHandler.refreshTokens();
  await nflHandler.refreshTokens();
  await paramountHandler.refreshTokens();
  await msgHandler.refreshTokens();
  await nesnHandler.refreshTokens();
  await cbsHandler.refreshTokens();
}, 1000 * 60 * 30);

// Remove idle playlists
setInterval(() => {
  const now = moment();

  for (const key of Object.keys(appStatus.channels)) {
    if (appStatus.channels[key] && appStatus.channels[key].heartbeat) {
      const channelHeartbeat = moment(appStatus.channels[key].heartbeat);

      if (now.diff(channelHeartbeat, 'minutes') > 5) {
        console.log(`Channel #${key} has been idle for more than 5 minutes. Removing playlist info.`);
        removeChannelStatus(key);
      }
    } else {
      console.log(`Channel #${key} was setup improperly... Removing.`);
      removeChannelStatus(key);
    }
  }
}, 1000 * 60);