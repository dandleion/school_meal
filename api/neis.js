// Vercel Function: keep the NEIS key on the server, never inside index.html.
const ENDPOINTS = new Set(['schoolInfo', 'mealServiceDietInfo']);
const KEYS = {
  schoolInfo: new Set(['ATPT_OFCDC_SC_CODE','SCHUL_NM','SD_SCHUL_CODE','pIndex']),
  mealServiceDietInfo: new Set(['ATPT_OFCDC_SC_CODE','SD_SCHUL_CODE','MLSV_FROM_YMD','MLSV_TO_YMD','MMEAL_SC_CODE','pIndex']),
};
const json = (value, status=200) => new Response(JSON.stringify(value), {
  status, headers: {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'}
});
export async function GET(request) {
  const key = process.env.NEIS_API_KEY;
  if (!key) return json({error:'관리자가 NEIS_API_KEY 환경변수를 등록하지 않았습니다.'},503);
  const incoming = new URL(request.url);
  const endpoint = incoming.searchParams.get('endpoint');
  if (!ENDPOINTS.has(endpoint)) return json({error:'지원하지 않는 API입니다.'},400);
  const target = new URL(`https://open.neis.go.kr/hub/${endpoint}`);
  target.searchParams.set('KEY',key);
  target.searchParams.set('Type','json');
  target.searchParams.set('pIndex','1');
  target.searchParams.set('pSize','1000');
  for (const [name, value] of incoming.searchParams) {
    if (name === 'endpoint') continue;
    if (!KEYS[endpoint].has(name)) return json({error:'허용되지 않은 검색 조건입니다.'},400);
    if (value.length > 120) return json({error:'검색 조건이 너무 깁니다.'},400);
    if (name === 'pIndex' && !/^\d{1,4}$/.test(value)) return json({error:'페이지 번호 형식이 잘못되었습니다.'},400);
    target.searchParams.set(name,value);
  }
  const office=target.searchParams.get('ATPT_OFCDC_SC_CODE');
  if (!office || !/^[A-Z]\d{2}$/.test(office)) return json({error:'교육청 코드를 확인하세요.'},400);
  if (endpoint === 'schoolInfo' && !(target.searchParams.get('SCHUL_NM') || target.searchParams.get('SD_SCHUL_CODE'))) return json({error:'학교 이름을 입력하세요.'},400);
  if (endpoint === 'mealServiceDietInfo') {
    if (!/^\d{7,10}$/.test(target.searchParams.get('SD_SCHUL_CODE')||'')) return json({error:'학교 코드를 확인하세요.'},400);
    const start=target.searchParams.get('MLSV_FROM_YMD')||'', end=target.searchParams.get('MLSV_TO_YMD')||'';
    if (!/^\d{8}$/.test(start) || !/^\d{8}$/.test(end)) return json({error:'날짜 형식이 잘못되었습니다.'},400);
    const a=Date.UTC(+start.slice(0,4),+start.slice(4,6)-1,+start.slice(6,8));
    const b=Date.UTC(+end.slice(0,4),+end.slice(4,6)-1,+end.slice(6,8));
    if (!Number.isFinite(a) || !Number.isFinite(b) || b<a || b-a>92*86400000) return json({error:'조회 기간은 최대 93일입니다.'},400);
  }
  try {
    const upstream = await fetch(target, {headers:{Accept:'application/json'}, signal:AbortSignal.timeout(12000)});
    if (!upstream.ok) return json({error:'나이스 API가 요청을 처리하지 못했습니다.'},502);
    const data=await upstream.json();
    return json(data);
  } catch(e) { return json({error:'나이스 API 연결이 실패했습니다. 잠시 후 다시 시도하세요.'},502); }
}
