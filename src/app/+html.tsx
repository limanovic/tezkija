import { ScrollViewStyleReset } from 'expo-router/html';
import { PropsWithChildren } from 'react';

/**
 * The HTML shell of every statically exported page (web only). Carries what
 * makes the site installable on a phone: the manifest, the home-screen
 * icon, the standalone flags, and the service worker registration.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="bs">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="theme-color" content="#F7F4EE" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#0E1220" media="(prefers-color-scheme: dark)" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Tezkija" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: BACKGROUND }} />
        <script dangerouslySetInnerHTML={{ __html: REGISTER_SW }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

// The page background before React paints, in the theme the OS asks for —
// otherwise the first frame flashes white on a dark phone.
const BACKGROUND = `
body { background-color: #F7F4EE; }
@media (prefers-color-scheme: dark) { body { background-color: #0E1220; } }
`;

const REGISTER_SW = `
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  });
}
`;
