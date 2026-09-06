import { usePathname } from 'expo-router';
import Head from 'expo-router/head';

/** Keep the exported ledger screens out of search; only the public home page is acquisition content. */
export const PrivateRouteHead = () => {
  const pathname = usePathname();

  if (pathname === '/') return null;

  return (
    <Head>
      <meta name="robots" content="noindex, nofollow, noarchive" />
      <meta name="googlebot" content="noindex, nofollow, noarchive" />
    </Head>
  );
};
