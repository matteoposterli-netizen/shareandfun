# SpiaggiaMia — App mobile (Capacitor / Android)

Wrapper Capacitor della SPA SpiaggiaMia con login biometrico. Bundle locale:
gli asset web vengono copiati dalla root in `www/` da `sync-web.sh`.

Documentazione completa, decisioni e roadmap: vedi **`../APP_MOBILE.md`**.

## Quick start (da questa cartella)
```bash
npm install
npm run sync:web        # assembla www/ dalla root
npx cap add android     # solo la prima volta (rigenera android/ dopo un clone pulito)
npm run cap:sync        # allinea www + plugin nativi
npm run android:run     # build + install su telefono Android collegato (USB debug)
```

> Il deploy web Vercel ignora questa cartella (`.vercelignore` in root).
> `www/` e `node_modules/` sono rigenerati e non versionati.
