export const config = { runtime: 'edge' };

export default async function handler() {
  return new Response(JSON.stringify({ ok: true, version: '1.0' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
