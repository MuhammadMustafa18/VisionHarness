import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Google+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Google+Sans+Code:wght@400;500;600&family=Google+Sans+Text:wght@400;500;600&family=Product+Sans:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </Head>
      <body className="antialiased bg-[#0d0e11] text-[#ededef]">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}

