// NEIS proxy for Vercel. Never store credentials in this source file.
const endpoints = new Set(['schoolInfo', 'mealServiceDietInfo']);
const allowed = {
  schoolInfo: new Set(['ATPT_OFCDC_SC_CODE', 'SCHUL_NM', 'SD_SCHUL_CODE', 'pIndex']),
  mealServiceDietInfo: new Set(['ATPT_OFCDC_SC_CODE', 'SD_SCHUL_CODE', 'MLSV_FROM_YMD', 'MLSV_TO_YMD', 'MMEAL_SC_CODE', 'pIndex'])
};
const respond = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}
});
const issue = (message, status, reason) => respond({error: message, reason}, status);
export async function GET(request) {
  const incoming = new URL(request.url);
  const endpoint = incoming.searchParams.get('endpoint');
  if (!endpoints.has(endpoint)) return issue('허용되지 않은 API입니다.', 400, 'INVALID_ENDPOINT');
  const key = (process.env.NEIS_API_KEY || '').trim();
  if (!key) return issue('Vercel 설정에 NEIS_API_KEY가 없습니다. Settings → Environment Variables에서 등록하고 다시 배포하세요.', 503, 'MISSING_KEY');
  const target = new URL(`https://open.neis.go.kr/hub/${endpoint}`);
  target.searchParams.set('KEY', key);
  target.searchParams.set('Type', 'json');
  target.searchParams.set('pIndex', '1');
  target.searchParams.set('pSize', '1000');
  for (const [name, val] of incoming.searchParams.entries()) {
    if (name === 'endpoint') continue;
    if (!allowed[endpoint].has(name) || val.length > 120) return issue('검색 조건이 올바르지 않습니다.', 400, 'INVALID_PARAM');
    if (name === 'pIndex' && !/^\d{1,4}$/.test(val)) return issue('페이지 번호가 잘못되었습니다.', 400, 'INVALID_PAGE');
    target.searchParams.set(name, val);
  }
  if (!/^[A-Z]\d{2}$/.test(target.searchParams.get('ATPT_OFCDC_SC_CODE') || '')) return issue('교육청 코드를 확인하세요.', 400, 'INVALID_OFFICE');
  if (endpoint === 'schoolInfo' && !(target.searchParams.get('SCHUL_NM') || target.searchParams.get('SD_SCHUL_CODE'))) return issue('학교 이름을 입력하세요.', 400, 'MISSING_SCHOOL');
  if (endpoint === 'mealServiceDietInfo') {
    if (!/^\d{7,10}$/.test(target.searchParams.get('SD_SCHUL_CODE') || '')) return issue('학교 코드를 확인하세요.', 400, 'INVALID_SCHOOL_CODE');
    const s = target.searchParams.get('MLSV_FROM_YMD') || '', e = target.searchParams.get('MLSV_TO_YMD') || '';
    if (!/^\d{8}$/.test(s) || !/^\d{8}$/.test(e)) return issue('날짜는 YYYYMMDD 형식이어야 합니다.', 400, 'INVALID_DATE');
    const a = Date.UTC(+s.slice(0,4), +s.slice(4,6)-1, +s.slice(6,8));
    const b = Date.UTC(+e.slice(0,4), +e.slice(4,6)-1, +e.slice(6,8));
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a || b - a > 92 * 86400000) return issue('조회 기간은 최대 93일입니다.', 400, 'INVALID_RANGE');
  }
  let upstream;
  try {
    upstream = await fetch(target, {headers:{Accept:'application/json'}, signal:AbortSignal.timeout(12000)});
  } catch (err) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    console.error('NEIS request failed', {type: err?.name, message: err?.message}); // Does not log URL or key
    return issue(timeout ? '나이스 API 응답 시간이 초과되었습니다. 잠시 후 다시 시도하세요.' : 'Vercel 서버에서 나이스 API로 연결하지 못했습니다. Vercel Functions 로그를 확인하세요.', 502, timeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_NETWORK');
  }
  const body = await upstream.text();
  if (!upstream.ok) {
    console.error('NEIS upstream HTTP status', upstream.status, 'content-type', upstream.headers.get('content-type'));
    return issue(`나이스 API가 HTTP ${upstream.status} 오류를 반환했습니다. 인증키 상태 또는 나이스 서비스 상태를 확인하세요.`, 502, 'UPSTREAM_HTTP_' + upstream.status);
  }
  let data;
  try { data = JSON.parse(body); } catch {
    console.error('NEIS responded non-JSON', {contentType:upstream.headers.get('content-type'), size:body.length});
    return issue('나이스 서버가 JSON이 아닌 응답을 보냈습니다. 인증키 권한 또는 API 서비스 상태를 확인하세요.', 502, 'UPSTREAM_NOT_JSON');
  }
  if (data?.RESULT?.CODE && !['INFO-000','INFO-100','INFO-200'].includes(data.RESULT.CODE)) {
    // NEIS may return HTTP 200 even when rejecting a key/request. Do not leak response body.
    return issue(`나이스 API 응답 오류 ${data.RESULT.CODE}: ${String(data.RESULT.MESSAGE || 'API 오류').slice(0,200)}`, 502, 'NEIS_RESULT');
  }
  return respond(data);
}
