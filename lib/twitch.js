// Connexion au chat Twitch (tmi.js).
//
// Mode du bot (config.json → bot.mode) :
//   - "auto" : connecté seulement quand un overlay est ouvert dans OBS sur
//     CETTE machine (signalé par les overlays via /api/events?obs=1). Si le PC
//     et le Mac tournent en même temps, seul celui qui diffuse répond au chat.
//   - "on"   : toujours connecté.
//   - "off"  : jamais.
// Sans jeton de bot, la connexion est anonyme : les commandes sont
// appliquées (l'overlay bouge) mais le bot ne peut pas répondre.
const EventEmitter = require('events');

class TwitchBot extends EventEmitter {
    constructor({ getConfig, engine }) {
        super();
        this.getConfig = getConfig;
        this.engine = engine;
        this.client = null;
        this.connected = false;
        this.obsSeenAt = 0;
        this.queue = [];
        this.sending = false;
        this.seen = new Map();
        this.lastError = null;
        this.channel = '';
        this.anonymous = true;
    }

    wanted() {
        const c = this.getConfig();
        if (!c.twitch.channel) return false;
        const mode = (c.bot && c.bot.mode) || 'auto';
        if (mode === 'off') return false;
        if (mode === 'on') return true;
        // auto : un overlay OBS s'est manifesté il y a moins de 90 s
        return Date.now() - this.obsSeenAt < 90 * 1000;
    }

    obsHeartbeat() {
        const was = this.wanted();
        this.obsSeenAt = Date.now();
        if (!was) this.reconcile();
    }

    start() {
        this.reconcile();
        this.timer = setInterval(() => this.reconcile(), 15 * 1000);
    }

    status() {
        const c = this.getConfig();
        return {
            mode: (c.bot && c.bot.mode) || 'auto',
            wanted: this.wanted(),
            connected: this.connected,
            channel: this.channel || c.twitch.channel,
            anonymous: this.anonymous,
            obsSeenAt: this.obsSeenAt || null,
            lastError: this.lastError
        };
    }

    async reconcile() {
        const want = this.wanted();
        const c = this.getConfig();
        const chan = (c.twitch.channel || '').toLowerCase().replace(/^#/, '');
        if (this.client && (!want || chan !== this.channel || this._token !== c.twitch.botToken)) {
            await this.disconnect();
        }
        if (want && !this.client) await this.connect();
    }

    async connect() {
        const c = this.getConfig();
        const tmi = require('tmi.js');
        this.channel = (c.twitch.channel || '').toLowerCase().replace(/^#/, '');
        this._token = c.twitch.botToken;
        const token = (c.twitch.botToken || '').trim();
        this.anonymous = !(token && c.twitch.botUsername);
        const opts = {
            options: { skipUpdatingEmotesets: true },
            connection: { reconnect: true, secure: true },
            channels: [this.channel]
        };
        if (!this.anonymous) {
            opts.identity = { username: c.twitch.botUsername, password: token.startsWith('oauth:') ? token : 'oauth:' + token };
        }
        const client = new tmi.Client(opts);
        this.client = client;
        client.on('message', (channel, tags, message, self) => this.onMessage(tags, message, self));
        client.on('connected', () => {
            this.connected = true; this.lastError = null;
            console.log(`💬 Chat Twitch connecté sur #${this.channel}${this.anonymous ? ' (lecture seule — pas de jeton de bot)' : ` en tant que ${c.twitch.botUsername}`}`);
            this.emit('status');
        });
        client.on('disconnected', reason => { this.connected = false; this.lastError = reason || null; this.emit('status'); });
        try { await client.connect(); }
        catch (e) {
            this.lastError = String(e && e.message || e);
            console.error('⚠️  Connexion Twitch impossible :', this.lastError);
            this.client = null; this.connected = false;
            this.emit('status');
        }
    }

    async disconnect() {
        const cl = this.client;
        this.client = null;
        this.connected = false;
        if (cl) { try { await cl.disconnect(); } catch (e) { /* déjà fermé */ } console.log('💬 Chat Twitch déconnecté'); }
        this.emit('status');
    }

    onMessage(tags, message, self) {
        if (self) return;
        const id = tags.id || `${tags['user-id']}:${message}`;
        const now = Date.now();
        if (this.seen.has(id)) return;
        this.seen.set(id, now);
        if (this.seen.size > 500) for (const [k, t] of this.seen) { if (now - t > 60000) this.seen.delete(k); }
        if (!message.startsWith('!')) return;
        const badges = tags.badges || {};
        const user = {
            login: tags.username,
            displayName: tags['display-name'] || tags.username,
            color: tags.color || null,
            isMod: !!tags.mod || !!badges.moderator,
            isBroadcaster: !!badges.broadcaster
        };
        // Pas de réponse à soi-même (compte du bot) ni aux autres bots connus.
        const c = this.getConfig();
        if (user.login === (c.twitch.botUsername || '').toLowerCase()) return;
        const replies = this.engine.handle(user, message);
        replies.forEach(r => this.say(r));
    }

    // File d'envoi : une réponse toutes les 1,2 s au plus (limites Twitch).
    say(text) {
        if (!this.client || this.anonymous || !this.connected) return;
        this.queue.push(text);
        if (this.queue.length > 30) this.queue.splice(0, this.queue.length - 30);
        this._pump();
    }

    async _pump() {
        if (this.sending) return;
        this.sending = true;
        while (this.queue.length && this.client) {
            const msg = this.queue.shift();
            try { await this.client.say('#' + this.channel, msg); }
            catch (e) { console.error('⚠️  Envoi chat :', e && e.message || e); }
            await new Promise(r => setTimeout(r, 1200));
        }
        this.sending = false;
    }
}

module.exports = { TwitchBot };
