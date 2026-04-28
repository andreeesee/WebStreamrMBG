import axios from 'axios';
import winston from 'winston';
import { createTestContext } from '../test';
import { Fetcher, FetcherMock } from '../utils';
import { ExtractorRegistry } from './ExtractorRegistry';
import { HubCloud } from './HubCloud';

const logger = winston.createLogger({ transports: [new winston.transports.Console({ level: 'nope' })] });
const extractorRegistry = new ExtractorRegistry(logger, [new HubCloud(new FetcherMock(`${__dirname}/__fixtures__/HubCloud`))]);

const ctx = createTestContext();

describe('HubCloud', () => {
  test('handle dexter original sin 2024 s01e01', async () => {
    expect(await extractorRegistry.handle(ctx, new URL('https://hubcloud.one/drive/idt1evqfuviqiei'))).toMatchSnapshot();
  });

  test('handle crayon shin-chan 1993', async () => {
    expect(await extractorRegistry.handle(ctx, new URL('https://hubcloud.one/drive/bffzqlpqfllfcld'))).toMatchSnapshot();
  });

  test('handle dark 2017 s03e08', async () => {
    expect(await extractorRegistry.handle(ctx, new URL('https://hubcloud.one/drive/nknlofk8snfnknh'))).toMatchSnapshot();
  });

  test('handle goat 2026', async () => {
    expect(await extractorRegistry.handle(ctx, new URL('https://hubcloud.foo/drive/p94k4dccjwxjcx4'))).toMatchSnapshot();
  });

  test('handle page with window.location redirect', async () => {
    expect(await extractorRegistry.handle(ctx, new URL('https://hubcloud.one/drive/windowloc'))).toMatchSnapshot();
  });

  test('handle page with location.replace redirect (hubrouting.site)', async () => {
    expect(await extractorRegistry.handle(ctx, new URL('https://hubcloud.one/drive/testhubrouting'))).toMatchSnapshot();
  });

  test('handle page with meta refresh redirect', async () => {
    expect(await extractorRegistry.handle(ctx, new URL('https://hubcloud.one/drive/testmetarefresh'))).toMatchSnapshot();
  });

  test('handle page with document.location redirect (no cookie)', async () => {
    expect(await extractorRegistry.handle(ctx, new URL('https://hubcloud.one/drive/testdocloc'))).toMatchSnapshot();
  });

  test('handle page with no redirect url', async () => {
    expect(await extractorRegistry.handle(ctx, new URL('https://hubcloud.one/drive/noredirect'))).toEqual([]);
  });

  test('handle token expired page (retry returns empty)', async () => {
    expect(await extractorRegistry.handle(ctx, new URL('https://hubcloud.one/drive/testtokenexpired'))).toEqual([]);
  });
});

describe('HubCloud retry logic', () => {
  test('retry succeeds after first Hop 2 returns empty page', async () => {
    // Create a fetcher mock that returns empty page on first Hop 2, then valid page on retry
    const fetcher = new Fetcher(axios.create(), logger);
    const hubCloud = new HubCloud(fetcher);

    const hop1Html = `<html><head><title>Test</title></head><body>
      <script>var url = 'https://hubrouting.site/hubcloud.php?host=hubcloud&id=retrytest&token=test';</script>
      <script>function stck(e,t,i){}stck('xlax',"s4t",1440);</script>
    </body></html>`;

    const emptyHop2Html = '<html><head><title>Error</title></head><body><p>Token expired</p></body></html>';

    const validHop2Html = `<html><head><title>Test.Retry.2024.1080p.mkv</title></head><body>
      <li class="list-group-item d-flex justify-content-between align-items-center">File Size<i id="size">1.0 GB</i></li>
      <a href="https://hub.retry-cdn.buzz/retry123?token=1774433000" id="fsl">Download [FSL Server]</a>
    </body></html>`;

    let textCallCount = 0;
    jest.spyOn(fetcher, 'text').mockImplementation(async () => {
      textCallCount++;
      // Call 1: Hop 1 page
      // Call 2: Hop 2 (empty/error)
      // Call 3: Hop 1 retry
      // Call 4: Hop 2 retry (valid)
      if (textCallCount === 1) return hop1Html;
      if (textCallCount === 2) return emptyHop2Html;
      if (textCallCount === 3) return hop1Html;
      return validHop2Html;
    });
    jest.spyOn(fetcher, 'setCookie').mockImplementation(() => { /* noop */ });

    const result = await hubCloud.extract(ctx, new URL('https://hubcloud.one/drive/retrytest'), {});

    expect(result).toHaveLength(1);
    expect(result.some(r => r.label === 'HubCloud (FSL)')).toBe(true);
    expect(result.some(r => r.url.href === 'https://hub.retry-cdn.buzz/retry123?token=1774433000')).toBe(true);
    expect(fetcher.setCookie).toHaveBeenCalledTimes(2); // Once for first attempt, once for retry
  });

  test('retry with no cookie name still works', async () => {
    const fetcher = new Fetcher(axios.create(), logger);
    const hubCloud = new HubCloud(fetcher);

    const hop1HtmlNoCookie = `<html><head><title>Test</title></head><body>
      <script>var url = 'https://hubrouting.site/hubcloud.php?host=hubcloud&id=nocookie&token=test';</script>
    </body></html>`;

    const emptyHop2Html = '<html><head><title>Error</title></head><body><p>Token expired</p></body></html>';

    const validHop2Html = `<html><head><title>Test.NoCookie.2024.720p.mkv</title></head><body>
      <li class="list-group-item d-flex justify-content-between align-items-center">File Size<i id="size">500 MB</i></li>
      <a href="https://hub.nocookie-cdn.buzz/nc456?token=1774434000" id="fsl">Download [FSL Server]</a>
    </body></html>`;

    let textCallCount = 0;
    jest.spyOn(fetcher, 'text').mockImplementation(async () => {
      textCallCount++;
      if (textCallCount === 1) return hop1HtmlNoCookie;
      if (textCallCount === 2) return emptyHop2Html;
      if (textCallCount === 3) return hop1HtmlNoCookie;
      return validHop2Html;
    });
    jest.spyOn(fetcher, 'setCookie').mockImplementation(() => { /* noop */ });

    const result = await hubCloud.extract(ctx, new URL('https://hubcloud.one/drive/nocookie'), {});

    expect(result).toHaveLength(1);
    expect(result.some(r => r.label === 'HubCloud (FSL)')).toBe(true);
    // setCookie should NOT be called since there's no stck() in the page
    expect(fetcher.setCookie).not.toHaveBeenCalled();
  });

  test('retry with no redirect URL found on retry returns empty', async () => {
    const fetcher = new Fetcher(axios.create(), logger);
    const hubCloud = new HubCloud(fetcher);

    const hop1HtmlWithRedirect = `<html><head><title>Test</title></head><body>
      <script>var url = 'https://hubrouting.site/hubcloud.php?host=hubcloud&id=noretry&token=test';</script>
      <script>function stck(e,t,i){}stck('xlax',"s4t",1440);</script>
    </body></html>`;

    const hop1HtmlNoRedirect = '<html><head><title>Test</title></head><body><p>No redirect</p></body></html>';

    const emptyHop2Html = '<html><head><title>Error</title></head><body><p>Token expired</p></body></html>';

    let textCallCount = 0;
    jest.spyOn(fetcher, 'text').mockImplementation(async () => {
      textCallCount++;
      if (textCallCount === 1) return hop1HtmlWithRedirect;
      if (textCallCount === 2) return emptyHop2Html;
      // On retry, Hop 1 returns a page with no redirect URL
      return hop1HtmlNoRedirect;
    });
    jest.spyOn(fetcher, 'setCookie').mockImplementation(() => { /* noop */ });

    const result = await hubCloud.extract(ctx, new URL('https://hubcloud.one/drive/noretry'), {});

    expect(result).toHaveLength(0);
  });
});
