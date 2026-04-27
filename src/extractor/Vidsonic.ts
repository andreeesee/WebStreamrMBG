import * as cheerio from 'cheerio';
import { Context, Format, InternalUrlResult, Meta } from '../types';
import { guessHeightFromPlaylist } from '../utils';
import { Extractor } from './Extractor';

function decodeHexUrl(hexString: string): string {
  const joined = hexString.split('|').join('');
  let decoded = '';
  for (let i = 0; i < joined.length; i += 2) {
    decoded += String.fromCharCode(parseInt(joined.substring(i, i + 2), 16));
  }
  return decoded.split('').reverse().join('');
}

export class Vidsonic extends Extractor {
  public readonly id = 'vidsonic';

  public readonly label = 'Vidsonic';

  public override readonly ttl: number = 43200000; // 12h

  public supports(_ctx: Context, url: URL): boolean {
    return null !== url.host.match(/vidsonic/);
  }

  protected async extractInternal(ctx: Context, url: URL, meta: Meta): Promise<InternalUrlResult[]> {
    const html = await this.fetcher.text(ctx, url);

    const $ = cheerio.load(html);
    const title = $('title').text().trim().replace(/^Watch /, '').trim();

    const hexMatch = html.match(/const _0x1\s*=\s*'([^']+)'/);
    if (!hexMatch || !hexMatch[1]) {
      throw new Error('Could not find hex-encoded video URL in Vidsonic page');
    }

    const m3u8Url = new URL(decodeHexUrl(hexMatch[1]));
    const headers = { Origin: url.origin };

    return [
      {
        url: m3u8Url,
        format: Format.hls,
        meta: {
          ...meta,
          height: meta.height ?? await guessHeightFromPlaylist(ctx, this.fetcher, m3u8Url, { headers }),
          title,
        },
        requestHeaders: headers,
      },
    ];
  }
}
