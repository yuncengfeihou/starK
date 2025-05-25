#!/usr/bin/env node

// native node modules
import fs from 'node:fs'; // ******** Added fs for directory checking ********
import path from 'node:path';
import util from 'node:util';
import net from 'node:net';
import dns from 'node:dns';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import cors from 'cors';
import { csrfSync } from 'csrf-sync';
import express from 'express';
import compression from 'compression';
import cookieSession from 'cookie-session';
import multer from 'multer';
import responseTime from 'response-time';
import helmet from 'helmet';
import bodyParser from 'body-parser';
import open from 'open';

// local library imports
import './src/fetch-patch.js';
import { serverEvents, EVENT_NAMES } from './src/server-events.js';
import { CommandLineParser } from './src/command-line.js';
import { loadPlugins } from './src/plugin-loader.js'; // Assuming plugin-loader.js is in ./src/
import {
    initUserStorage,
    getCookieSecret,
    getCookieSessionName,
    ensurePublicDirectoriesExist,
    getUserDirectoriesList,
    migrateSystemPrompts,
    migrateUserData,
    requireLoginMiddleware,
    setUserDataMiddleware,
    shouldRedirectToLogin,
    cleanUploads,
    getSessionCookieAge,
    verifySecuritySettings,
    loginPageMiddleware,
} from './src/users.js';

import getWebpackServeMiddleware from './src/middleware/webpack-serve.js';
import basicAuthMiddleware from './src/middleware/basicAuth.js';
import getWhitelistMiddleware from './src/middleware/whitelist.js';
import accessLoggerMiddleware, { getAccessLogPath, migrateAccessLog } from './src/middleware/accessLogWriter.js';
import multerMonkeyPatch from './src/middleware/multerMonkeyPatch.js';
import initRequestProxy from './src/request-proxy.js';
import getCacheBusterMiddleware from './src/middleware/cacheBuster.js';
import corsProxyMiddleware from './src/middleware/corsProxy.js';
import {
    getVersion,
    color, // ******** Added color for logging ********
    removeColorFormatting,
    getSeparator,
    safeReadFileSync,
    setupLogLevel,
    setWindowTitle,
} from './src/util.js';
import { UPLOADS_DIRECTORY } from './src/constants.js';
import { ensureThumbnailCache } from './src/endpoints/thumbnails.js';

// Routers
import { router as usersPublicRouter } from './src/endpoints/users-public.js';
import { init as statsInit, onExit as statsOnExit } from './src/endpoints/stats.js';
import { checkForNewContent } from './src/endpoints/content-manager.js';
import { init as settingsInit } from './src/endpoints/settings.js';
import { redirectDeprecatedEndpoints, ServerStartup, setupPrivateEndpoints } from './src/server-startup.js';
import { diskCache } from './src/endpoints/characters.js';

// Unrestrict console logs display limit
util.inspect.defaultOptions.maxArrayLength = null;
util.inspect.defaultOptions.maxStringLength = null;
util.inspect.defaultOptions.depth = 4;

// Set a working directory for the server
const serverDirectory = import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url));
console.log(`Node version: ${process.version}. Running in ${process.env.NODE_ENV} environment. Server directory: ${serverDirectory}`);
process.chdir(serverDirectory);

// Work around a node v20.0.0, v20.1.0, and v20.2.0 bug. The issue was fixed in v20.3.0.
if (process.versions && process.versions.node && process.versions.node.match(/20\.[0-2]\.0/)) {
    // @ts-ignore
    if (net.setDefaultAutoSelectFamily) net.setDefaultAutoSelectFamily(false);
}

const cliArgs = new CommandLineParser().parse(process.argv);
globalThis.DATA_ROOT = cliArgs.dataRoot;
globalThis.COMMAND_LINE_ARGS = cliArgs;

if (!cliArgs.enableIPv6 && !cliArgs.enableIPv4) {
    console.error('error: You can\'t disable all internet protocols: at least IPv6 or IPv4 must be enabled.');
    process.exit(1);
}

try {
    if (cliArgs.dnsPreferIPv6) {
        dns.setDefaultResultOrder('ipv6first');
        console.log('Preferring IPv6 for DNS resolution');
    } else {
        dns.setDefaultResultOrder('ipv4first');
        console.log('Preferring IPv4 for DNS resolution');
    }
} catch (error) {
    console.warn('Failed to set DNS resolution order. Possibly unsupported in this Node version.');
}

const app = express();
app.use(helmet({
    contentSecurityPolicy: false,
}));
app.use(compression());
app.use(responseTime());

app.use(bodyParser.json({ limit: '200mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '200mb' }));

// CORS Settings //
const CORS = cors({
    origin: 'null',
    methods: ['OPTIONS'],
});

app.use(CORS);

if (cliArgs.listen && cliArgs.basicAuthMode) {
    app.use(basicAuthMiddleware);
}

if (cliArgs.whitelistMode) {
    const whitelistMiddleware = await getWhitelistMiddleware();
    app.use(whitelistMiddleware);
}

if (cliArgs.listen) {
    app.use(accessLoggerMiddleware());
}

if (cliArgs.enableCorsProxy) {
    app.use('/proxy/:url(*)', corsProxyMiddleware);
} else {
    app.use('/proxy/:url(*)', async (_, res) => {
        const message = 'CORS proxy is disabled. Enable it in config.yaml or use the --corsProxy flag.';
        console.log(message);
        res.status(404).send(message);
    });
}

app.use(cookieSession({
    name: getCookieSessionName(),
    sameSite: 'lax',
    httpOnly: true,
    maxAge: getSessionCookieAge(),
    secret: getCookieSecret(globalThis.DATA_ROOT),
}));

app.use(setUserDataMiddleware);

// CSRF Protection //
if (!cliArgs.disableCsrf) {
    const csrfSyncProtection = csrfSync({
        getTokenFromState: (req) => {
            if (!req.session) {
                console.error('(CSRF error) getTokenFromState: Session object not initialized');
                return;
            }
            return req.session.csrfToken;
        },
        getTokenFromRequest: (req) => {
            return req.headers['x-csrf-token']?.toString();
        },
        storeTokenInState: (req, token) => {
            if (!req.session) {
                console.error('(CSRF error) storeTokenInState: Session object not initialized');
                return;
            }
            req.session.csrfToken = token;
        },
        size: 32,
    });

    app.get('/csrf-token', (req, res) => {
        res.json({
            'token': csrfSyncProtection.generateToken(req),
        });
    });

    csrfSyncProtection.invalidCsrfTokenError.message = color.red('Invalid CSRF token. Please refresh the page and try again.');
    csrfSyncProtection.invalidCsrfTokenError.stack = undefined;

    app.use(csrfSyncProtection.csrfSynchronisedProtection);
} else {
    console.warn('\nCSRF protection is disabled. This will make your server vulnerable to CSRF attacks.\n');
    app.get('/csrf-token', (req, res) => {
        res.json({
            'token': 'disabled',
        });
    });
}

// Static files
app.get('/', getCacheBusterMiddleware(), (request, response) => {
    if (shouldRedirectToLogin(request)) {
        const query = request.url.split('?')[1];
        const redirectUrl = query ? `/login?${query}` : '/login';
        return response.redirect(redirectUrl);
    }
    return response.sendFile('index.html', { root: path.join(process.cwd(), 'public') });
});

app.get('/callback/:source?', (request, response) => {
    const source = request.params.source;
    const query = request.url.split('?')[1];
    const searchParams = new URLSearchParams();
    source && searchParams.set('source', source);
    query && searchParams.set('query', query);
    const path = `/?${searchParams.toString()}`;
    return response.redirect(307, path);
});

app.get('/login', loginPageMiddleware);

const webpackMiddleware = getWebpackServeMiddleware();
app.use(webpackMiddleware);
app.use(express.static(process.cwd() + '/public', {}));

app.use('/api/users', usersPublicRouter);

app.use(requireLoginMiddleware);
app.get('/api/ping', (request, response) => {
    if (request.query.extend && request.session) {
        request.session.touch = Date.now();
    }
    response.sendStatus(204);
});

const uploadsPath = path.join(cliArgs.dataRoot, UPLOADS_DIRECTORY);
app.use(multer({ dest: uploadsPath, limits: { fieldSize: 10 * 1024 * 1024 } }).single('avatar'));
app.use(multerMonkeyPatch);

app.get('/version', async function (_, response) {
    const data = await getVersion();
    response.send(data);
});

redirectDeprecatedEndpoints(app);
setupPrivateEndpoints(app);

async function preSetupTasks() {
    const version = await getVersion();
    console.log();
    console.log(`SillyTavern ${version.pkgVersion}`);
    if (version.gitBranch) {
        console.log(`Running '${version.gitBranch}' (${version.gitRevision}) - ${version.commitDate}`);
        if (!version.isLatest && ['staging', 'release'].includes(version.gitBranch)) {
            console.log('INFO: Currently not on the latest commit.');
            console.log('      Run \'git pull\' to update. If you have any merge conflicts, run \'git reset --hard\' and \'git pull\' to reset your branch.');
        }
    }
    console.log();

    const directories = await getUserDirectoriesList();
    await checkForNewContent(directories);
    await ensureThumbnailCache(directories);
    await diskCache.verify(directories);
    cleanUploads();
    migrateAccessLog();

    await settingsInit();
    await statsInit();

    // ******** MODIFICATION STARTS HERE ********
    const allCleanupFunctions = [];

    // Load core server plugins
    const corePluginsDirectory = path.join(serverDirectory, 'plugins');
    console.log(color.blue(`Loading core server plugins from: ${corePluginsDirectory}`));
    const cleanupCorePlugins = await loadPlugins(app, corePluginsDirectory);
    if (typeof cleanupCorePlugins === 'function') {
        allCleanupFunctions.push(cleanupCorePlugins);
    }

    // Load third-party extensions' server-side logic
    console.log(color.blue('Attempting to load server-side logic for third-party extensions...'));
    const thirdPartyExtensionsPath = path.join(serverDirectory, 'public', 'extensions', 'third-party');

    if (fs.existsSync(thirdPartyExtensionsPath)) {
        const thirdPartyPluginFolders = fs.readdirSync(thirdPartyExtensionsPath)
            .filter(folderName => {
                const fullPath = path.join(thirdPartyExtensionsPath, folderName);
                // Ensure it's a directory and not hidden (e.g. .git, .vscode)
                return fs.statSync(fullPath).isDirectory() && !folderName.startsWith('.');
            });

        for (const pluginFolder of thirdPartyPluginFolders) {
            const fullPluginDirectoryPath = path.join(thirdPartyExtensionsPath, pluginFolder);
            // loadPlugins expects a path to a directory containing plugins (or plugin files directly).
            // Here, fullPluginDirectoryPath is the directory of a single third-party plugin.
            // loadPlugins will iterate its contents. If it finds index.js/mjs/cjs, it will load it.
            // If it finds a subdirectory, it would try to load from there (not typical for simple third-party server scripts).
            console.log(color.cyan(`  Checking for server-side logic in third-party extension: ${pluginFolder}`));
            const cleanupThirdPartyPlugin = await loadPlugins(app, fullPluginDirectoryPath);
            if (typeof cleanupThirdPartyPlugin === 'function') {
                allCleanupFunctions.push(cleanupThirdPartyPlugin);
            }
        }
        console.log(color.blue('Finished attempting to load third-party extension server-side logic.'));
    } else {
        console.log(color.yellow(`Third-party extensions directory not found at ${thirdPartyExtensionsPath}, skipping server-side load for them.`));
    }
    // ******** MODIFICATION ENDS HERE ********

    const consoleTitle = process.title;
    let isExiting = false;
    const exitProcess = async () => {
        if (isExiting) return;
        isExiting = true;
        await statsOnExit();
        // Call all collected cleanup functions
        console.log(color.blue('Running plugin cleanup functions...'));
        for (const cleanupFn of allCleanupFunctions) {
            try {
                await cleanupFn();
            } catch (cleanupError) {
                console.error(color.red('Error during plugin cleanup:'), cleanupError);
            }
        }
        console.log(color.blue('Plugin cleanup finished.'));
        diskCache.dispose();
        setWindowTitle(consoleTitle);
        process.exit();
    };

    process.on('SIGINT', exitProcess);
    process.on('SIGTERM', exitProcess);
    process.on('uncaughtException', (err) => {
        console.error('Uncaught exception:', err);
        exitProcess();
    });

    initRequestProxy({ enabled: cliArgs.requestProxyEnabled, url: cliArgs.requestProxyUrl, bypass: cliArgs.requestProxyBypass });
    await webpackMiddleware.runWebpackCompiler();
}

async function postSetupTasks(result) {
    const autorunHostname = await cliArgs.getAutorunHostname(result);
    const autorunUrl = cliArgs.getAutorunUrl(autorunHostname);

    if (cliArgs.autorun) {
        try {
            console.log('Launching in a browser...');
            await open(autorunUrl.toString());
        } catch (error) {
            console.error('Failed to launch the browser. Open the URL manually.');
        }
    }

    setWindowTitle('SillyTavern WebServer');
    let logListen = 'SillyTavern is listening on';
    if (result.useIPv6 && !result.v6Failed) {
        logListen += color.green(' IPv6: ' + cliArgs.getIPv6ListenUrl().host);
    }
    if (result.useIPv4 && !result.v4Failed) {
        logListen += color.green(' IPv4: ' + cliArgs.getIPv4ListenUrl().host);
    }
    const goToLog = 'Go to: ' + color.blue(autorunUrl) + ' to open SillyTavern';
    const plainGoToLog = removeColorFormatting(goToLog);
    console.log(logListen);
    if (cliArgs.listen) {
        console.log();
        console.log('To limit connections to internal localhost only ([::1] or 127.0.0.1), change the setting in config.yaml to "listen: false".');
        console.log('Check the "access.log" file in the data directory to inspect incoming connections:', color.green(getAccessLogPath()));
    }
    console.log('\n' + getSeparator(plainGoToLog.length) + '\n');
    console.log(goToLog);
    console.log('\n' + getSeparator(plainGoToLog.length) + '\n');

    setupLogLevel();
    serverEvents.emit(EVENT_NAMES.SERVER_STARTED, { url: autorunUrl });
}

function apply404Middleware() {
    const notFoundWebpage = safeReadFileSync('./public/error/url-not-found.html') ?? '';
    app.use((req, res) => {
        res.status(404).send(notFoundWebpage);
    });
}

initUserStorage(globalThis.DATA_ROOT)
    .then(ensurePublicDirectoriesExist)
    .then(migrateUserData)
    .then(migrateSystemPrompts)
    .then(verifySecuritySettings)
    .then(preSetupTasks)
    .then(apply404Middleware)
    .then(() => new ServerStartup(app, cliArgs).start())
    .then(postSetupTasks)
    .catch(err => { // ******** Added global catch for startup errors ********
        console.error(color.red('Fatal error during server startup sequence:'), err);
        process.exit(1);
    });
