// GOATCOUNTER_CODE is the site code: the `rookery` in rookery.goatcounter.com.
// Accept the dashboard URL too, and say plainly when the API token was pasted.
export function goatcounterCode(raw) {
  const value = (raw ?? '').trim();
  if (!value) return { code: undefined };
  const fromUrl = value.match(/^(?:https?:\/\/)?([a-z0-9-]+)\.goatcounter\.com(?:[/?#]|$)/i);
  const code = (fromUrl ? fromUrl[1] : value).toLowerCase();
  const looksLikeToken = code.length > 30 && /\d/.test(code);
  if (looksLikeToken || !/^[a-z0-9-]{2,50}$/.test(code)) {
    return {
      error:
        `\`GOATCOUNTER_CODE\` is set to something that isn't a site code${looksLikeToken ? ' (it looks like an API token)' : ''}. ` +
        'It should be the first part of the dashboard address: `rookery` for rookery.goatcounter.com.',
    };
  }
  return { code };
}
