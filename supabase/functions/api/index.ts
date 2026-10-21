import { createClient } from 'npm:@supabase/supabase-js@2';
import { SignJWT, jwtVerify } from 'npm:jose@5';
import bcrypt from 'npm:bcryptjs@2.4.3';
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const secret = new TextEncoder().encode(serviceKey);
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (message: string, status = 400) => json({ error: message }, status);
const readBody = async (req: Request) => { try { return await req.json(); } catch { return {}; } };
const route = (req: Request) => new URL(req.url).pathname.replace(/^.*\/(?:functions\/v1\/)?api(?=\/|$)/, '') || '/';
const publicApiUrl = (req: Request) => {
  const url = new URL(req.url);
  return `https://${url.host}/functions/v1/api`;
};
const mediaType = (mime: string | null | undefined) => String(mime || '').toLowerCase().startsWith('video/') ? 'video' : 'image';
const mediaExtension = (mime: string) => mime === 'video/quicktime' ? 'mov' : mime === 'video/3gpp' ? '3gp' : mime.split('/')[1] || 'bin';
const publicViewerUrl = (token: string) =>
  `https://eklavya-yadav-1711.github.io/RESQURA/?token=${encodeURIComponent(token)}`;
const issue = (id: number) => new SignJWT({ userId: id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('30d').sign(secret);
const authUser = async (req: Request) => { const raw = req.headers.get('authorization')?.replace(/^Bearer\s+/i, ''); if (!raw) return null; try { const { payload } = await jwtVerify(raw, secret); return Number(payload.userId) || null; } catch { return null; } };
const requireUser = async (req: Request) => { const id = await authUser(req); if (!id) throw Object.assign(new Error('Invalid or expired token'), { status: 401 }); return id; };
const sosParticipant = async (sosId: number, uid: number) => {
  const { data: sos, error } = await db.from('sos_sessions').select('id,victim_id,status').eq('id', sosId).maybeSingle();
  if (error) throw error;
  if (!sos || sos.status !== 'active') return null;
  if (Number(sos.victim_id) === uid) return sos;
  const { data: responder, error: responderError } = await db.from('sos_responders')
    .select('id').eq('sos_id', sosId).eq('responder_id', uid).in('status', ['alerted', 'responding', 'arrived']).maybeSingle();
  if (responderError) throw responderError;
  return responder ? sos : null;
};
const distanceKm = (aLat: number, aLon: number, bLat: number, bLon: number) => {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};
const signedImageUrl = async (path: string | null | undefined) => {
  if (!path) return null;
  const { data, error } = await db.storage.from('sos-media').createSignedUrl(path, 3600);
  if (error) throw error;
  return data?.signedUrl || null;
};
const trackingPage = (apiBase: string) => `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1"><title>RESQORA live emergency</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>body{margin:0;background:#0a1628;color:#f8fafc;font:16px system-ui,sans-serif}main{max-width:720px;margin:auto;padding:20px}h1{font-size:22px}#status{color:#cbd5e1;margin-bottom:14px}#map{height:60vh;min-height:320px;border-radius:14px;overflow:hidden}</style>
</head><body><main><h1>RESQORA emergency location</h1><div id="status">Loading live location...</div><div id="map"></div></main>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script>
const token=new URLSearchParams(location.search).get('token'),endpoint=${JSON.stringify(apiBase)}+'/t/'+encodeURIComponent(token)+'/data',map=L.map('map').setView([20,0],2);L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; OpenStreetMap contributors'}).addTo(map);let victim,responders=[];
async function update(){try{const r=await fetch(endpoint,{cache:'no-store'});if(!r.ok)throw Error();const d=await r.json();document.getElementById('status').textContent=(d.victimName||'Someone')+' needs help. '+(d.message||'');if(victim)map.removeLayer(victim);responders.forEach(x=>map.removeLayer(x));responders=[];if(Number.isFinite(d.lat)&&Number.isFinite(d.lon)){victim=L.circleMarker([d.lat,d.lon],{radius:9,color:'#ef4444',fillOpacity:.9}).addTo(map).bindPopup('Emergency location');const points=[[d.lat,d.lon]];(d.responders||[]).forEach(x=>{if(Number.isFinite(x.lat)&&Number.isFinite(x.lon)){const m=L.circleMarker([x.lat,x.lon],{radius:8,color:'#22c55e',fillOpacity:.9}).addTo(map).bindPopup(x.name||'Responder');responders.push(m);points.push([x.lat,x.lon])}});map.fitBounds(points,{padding:[30,30],maxZoom:15})}if(d.status!=='active')document.getElementById('status').textContent='This emergency has ended.'}catch(e){document.getElementById('status').textContent='This tracking link is unavailable.'}}update();setInterval(update,10000);
</script></body></html>`;
const viewerPath = 'viewer.html';
const ensureViewer = async (apiBase: string) => {
  const bucket = await db.storage.createBucket('sos-public', { public: true });
  if (bucket.error && !/already exists/i.test(bucket.error.message || '')) throw bucket.error;
  const upload = await db.storage.from('sos-public').upload(viewerPath, trackingPage(apiBase), {
    contentType: 'text/html; charset=utf-8',
    cacheControl: '60',
    upsert: true,
  });
  if (upload.error) throw upload.error;
  const metadata = await db.storage.from('sos-public').update(viewerPath, trackingPage(apiBase), {
    contentType: 'text/html; charset=utf-8',
    cacheControl: '60',
    upsert: true,
  });
  if (metadata.error) throw metadata.error;
  return `${supabaseUrl}/storage/v1/object/public/sos-public/${viewerPath}`;
};
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const p = route(req);
  try {
    const input = req.method === 'GET' ? Object.fromEntries(new URL(req.url).searchParams) : await readBody(req);
    if (p === '/config' || p.endsWith('/config')) return json({ defaultMessage: 'I am here. Please come and help me.', defaultRangeKm: 2, maxRangeKm: 10, maxMessageLength: 300, maxImageBytes: 5242880, maxVideoBytes: 20971520, maxVideoSeconds: 30, imageEnabled: true, videoEnabled: true, hotlines: { police: '112', ambulance: '108' } });
    const trackingMatch = p.match(/^\/t\/([^/]+)(\/data)?$/);
    if (trackingMatch) {
      const token = trackingMatch[1];
      const { data: tracked } = await db.from('sos_sessions')
        .select('id,status,victim_lat,victim_lon,message,image_url,image_mime_type,started_at,users!sos_sessions_victim_id_fkey(name),sos_responders(id,status,responder_id,users!sos_responders_responder_id_fkey(id,name,latitude,longitude))')
        .eq('share_token', token).maybeSingle();
      if (!tracked) return trackingMatch[2]
        ? fail('Unknown tracking link', 404)
        : new Response('This tracking link is not valid.', { status: 404, headers: { ...cors, 'Content-Type': 'text/plain' } });
      if (!trackingMatch[2]) {
        const viewerUrl = await ensureViewer(publicApiUrl(req));
        return new Response(null, {
          status: 302,
          headers: { ...cors, Location: `${viewerUrl}?token=${encodeURIComponent(token)}`, 'Cache-Control': 'no-store' },
        });
      }
      return json({
        status: tracked.status,
        victimName: (tracked.users as any)?.name || 'Someone',
        message: tracked.message,
        lat: Number(tracked.victim_lat),
        lon: Number(tracked.victim_lon),
        startedAt: tracked.started_at,
        alerted: (tracked.sos_responders || []).length,
        imageUrl: await signedImageUrl(tracked.image_url),
        mediaType: mediaType(tracked.image_mime_type),
        responders: (tracked.sos_responders || []).map((row: any) => ({
          id: row.users?.id || row.responder_id,
          name: row.users?.name || 'Responder',
          status: row.status,
          lat: Number(row.users?.latitude),
          lon: Number(row.users?.longitude),
          distance: Number.isFinite(Number(row.users?.latitude))
            && Number.isFinite(Number(row.users?.longitude))
            ? distanceKm(
              Number(tracked.victim_lat),
              Number(tracked.victim_lon),
              Number(row.users.latitude),
              Number(row.users.longitude)
            )
            : null,
        })),
      });
    }
    if (p === '/auth/register' && req.method === 'POST') {
      const name = String(input.name || '').trim(), phone = String(input.phone || '').trim(), password = String(input.password || '');
      if (!name || !phone || password.length < 4) return fail('Name, phone and password required');
      const { data: exists } = await db.from('users').select('id').eq('phone', phone).maybeSingle();
      if (exists) return fail('Phone number already registered', 409);
      const { data, error } = await db.from('users').insert({ name, phone, password: await bcrypt.hash(password, 12) }).select('id,name,phone').single();
      if (error) throw error;
      return json({ success: true, token: await issue(data.id), user: data });
    }
    if (p === '/auth/login' && req.method === 'POST') {
      const phone = String(input.phone || '').trim(), password = String(input.password || '');
      const { data } = await db.from('users').select('*').eq('phone', phone).maybeSingle();
      if (!data || !await bcrypt.compare(password, data.password)) return fail('Invalid phone or password', 401);
      return json({ success: true, token: await issue(data.id), user: { id: data.id, name: data.name, phone: data.phone } });
    }
    if (p === '/auth/password' && req.method === 'POST') {
      const accessToken = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
      if (!accessToken) return fail('Reset session required', 401);
      const { data: authData, error: authError } = await db.auth.getUser(accessToken);
      if (authError || !authData.user?.email) return fail('Reset session expired', 401);
      const password = String(input.password || '');
      if (password.length < 6) return fail('Password must be at least 6 characters');
      const { error } = await db.from('users')
        .update({ password: await bcrypt.hash(password, 12) })
        .eq('phone', authData.user.email);
      if (error) throw error;
      return json({ success: true });
    }
    const uid = await requireUser(req);
    if (p === '/user/me') { const { data, error } = await db.from('users').select('id,name,phone,latitude,longitude,is_online').eq('id', uid).single(); if (error) throw error; return json({ user: data }); }
    if (p === '/user/location' && req.method === 'POST') { await db.from('users').update({ latitude: Number(input.lat), longitude: Number(input.lon), is_online: true, last_seen: new Date().toISOString() }).eq('id', uid); return json({ success: true }); }
    if (p === '/contacts' && req.method === 'GET') { const { data = [] } = await db.from('emergency_contacts').select('*').eq('user_id', uid).order('created_at'); return json({ contacts: data, max: 5 }); }
    if (p === '/contacts' && req.method === 'POST') {
      const { data, error } = await db.from('emergency_contacts')
        .insert({ user_id: uid, name: String(input.name || '').trim(), phone: String(input.phone || '').trim() })
        .select().single();
      if (error) throw error;
      const { data: contacts = [] } = await db.from('emergency_contacts')
        .select('*').eq('user_id', uid).order('created_at');
      return json({ success: true, contact: data, contacts, max: 5 });
    }
    if (/^\/contacts\/\d+$/.test(p) && req.method === 'DELETE') {
      await db.from('emergency_contacts').delete().eq('id', Number(p.split('/').pop())).eq('user_id', uid);
      const { data: contacts = [] } = await db.from('emergency_contacts')
        .select('*').eq('user_id', uid).order('created_at');
      return json({ success: true, contacts, max: 5 });
    }
    if (p === '/stats') { const { count } = await db.from('users').select('*', { count: 'exact', head: true }); const { count: active } = await db.from('sos_sessions').select('*', { count: 'exact', head: true }).eq('status', 'active'); return json({ onlineCount: count || 0, othersOnline: Math.max(0, (count || 0) - 1), activeSOS: active || 0 }); }
    if (p === '/sos/trigger' && req.method === 'POST') {
      const lat = Number(input.lat), lon = Number(input.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return fail('Valid location required');
      const { data: old } = await db.from('sos_sessions').select('id').eq('victim_id', uid).eq('status', 'active').maybeSingle();
      if (old) return fail('You already have an active SOS');
      const shareToken = crypto.randomUUID().replaceAll('-', '');
      const { data, error } = await db.from('sos_sessions').insert({ victim_id: uid, victim_lat: lat, victim_lon: lon, message: String(input.message || 'I am here. Please come and help me.').slice(0, 300), range_km: Math.min(10, Math.max(.1, Number(input.range) || 2)), status: 'active', share_token: shareToken }).select().single();
      if (error) throw error;
      const image = input.image;
      if (image?.dataUri) {
        const match = /^data:([^;]+);base64,(.+)$/s.exec(image.dataUri);
        if (!match || !['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'video/mp4', 'video/quicktime', 'video/3gpp'].includes(match[1].toLowerCase())) return fail('Unsupported media type');
        const bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
        const maxBytes = match[1].toLowerCase().startsWith('video/') ? 20 * 1024 * 1024 : 5 * 1024 * 1024;
        if (bytes.byteLength > maxBytes) return fail(match[1].toLowerCase().startsWith('video/') ? 'Video must be 20 MB or smaller' : 'Image must be 5 MB or smaller');
        const key = `sos/${crypto.randomUUID()}.${mediaExtension(match[1].toLowerCase())}`;
        const upload = await db.storage.from('sos-media').upload(key, bytes, { contentType: match[1], upsert: false });
        if (upload.error) throw upload.error;
        await db.from('sos_sessions').update({ image_url: key, image_mime_type: match[1], image_name: String(image.fileName || key) }).eq('id', data.id).eq('victim_id', uid);
        data.image_url = key; data.image_mime_type = match[1]; data.image_name = String(image.fileName || key);
      }
      // A session alone is not an alert. Create a responder record for every
      // nearby, located user so /sos/incoming can reliably show the SOS even
      // when Realtime or a push notification is unavailable.
      const { data: candidates, error: candidateError } = await db.from('users')
        .select('id,name,latitude,longitude,push_token')
        .neq('id', uid).not('latitude', 'is', null).not('longitude', 'is', null);
      if (candidateError) throw candidateError;
      const range = Number(data.range_km);
      const targets = (candidates || []).filter((user: any) =>
        Number.isFinite(Number(user.latitude)) && Number.isFinite(Number(user.longitude)) &&
        distanceKm(lat, lon, Number(user.latitude), Number(user.longitude)) <= range
      );
      if (targets.length) {
        const { error: responderError } = await db.from('sos_responders').upsert(
          targets.map((user: any) => ({ sos_id: data.id, responder_id: user.id, status: 'alerted' })),
          { onConflict: 'sos_id,responder_id', ignoreDuplicates: true }
        );
        if (responderError) throw responderError;

        const { data: victim } = await db.from('users').select('name').eq('id', uid).maybeSingle();
        const victimName = victim?.name || 'Someone nearby';
        const messages = targets.filter((user: any) => typeof user.push_token === 'string' && /^Expo(nent)?PushToken\[.+\]$/.test(user.push_token))
          .map((user: any) => ({
            to: user.push_token,
            title: `🚨 ${victimName} needs help`,
            body: data.message,
            sound: 'default', priority: 'high', channelId: 'sos-alerts',
            data: { type: 'sos_alert', sosId: data.id, victimName, location: { lat, lon }, range },
          }));
        if (messages.length) fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(messages),
        }).catch(() => {});
      }
      return json({ success: true, sosId: data.id, sos: data, shareUrl: publicViewerUrl(shareToken), alerted: targets.length });
    }
    if (p === '/sos/mine/clear' && req.method === 'POST') {
      const { data: cleared, error } = await db.from('sos_sessions')
        .update({ status: 'ended', ended_at: new Date().toISOString() })
        .eq('victim_id', uid)
        .eq('status', 'active')
        .select('id');
      if (error) throw error;
      return json({
        success: true,
        cleared: cleared?.length || 0,
        sosIds: (cleared || []).map((sos: any) => sos.id),
      });
    }
    if (p === '/sos/active') {
      const { data } = await db.from('sos_sessions')
        .select('*,sos_responders(id,responder_id,status,users!sos_responders_responder_id_fkey(id,name,latitude,longitude))')
        .eq('victim_id', uid).eq('status', 'active').maybeSingle();
      if (data && !data.share_token) {
        data.share_token = crypto.randomUUID().replaceAll('-', '');
        const { error } = await db.from('sos_sessions').update({ share_token: data.share_token }).eq('id', data.id);
        if (error) throw error;
      }
      const { data: contacts = [], error: contactsError } = await db.from('emergency_contacts')
        .select('*').eq('user_id', uid).order('created_at');
      if (contactsError) throw contactsError;
      const imageUrl = await signedImageUrl(data?.image_url);
      const responders = (data?.sos_responders || []).map((row: any) => ({
        id: row.users?.id || row.responder_id,
        name: row.users?.name || 'Responder',
        status: row.status,
        latitude: row.users?.latitude ?? null,
        longitude: row.users?.longitude ?? null,
        distance: data
          && Number.isFinite(Number(data.victim_lat))
          && Number.isFinite(Number(data.victim_lon))
          && Number.isFinite(Number(row.users?.latitude))
          && Number.isFinite(Number(row.users?.longitude))
          ? distanceKm(
            Number(data.victim_lat),
            Number(data.victim_lon),
            Number(row.users.latitude),
            Number(row.users.longitude)
          )
          : null,
      }));
      return json({
        active: !!data,
        sos: data ? { ...data, imageUrl, mediaType: mediaType(data.image_mime_type) } : data,
        shareUrl: data?.share_token ? publicViewerUrl(data.share_token) : null,
        contacts,
        responders,
      });
    }
    if (p === '/sos/incoming') {
      const { data: me } = await db.from('users').select('latitude,longitude').eq('id', uid).maybeSingle();
      if (!me || !Number.isFinite(Number(me.latitude)) || !Number.isFinite(Number(me.longitude))) {
        return json({ alerts: [] });
      }

      const { data: activeSOS = [], error: activeError } = await db.from('sos_sessions')
        .select('id,victim_id,victim_lat,victim_lon,message,image_url,image_mime_type,range_km,status,users!sos_sessions_victim_id_fkey(id,name)')
        .eq('status', 'active');
      if (activeError) throw activeError;

      const nearby = activeSOS.filter((sos: any) =>
        sos.victim_id !== uid
        && distanceKm(Number(sos.victim_lat), Number(sos.victim_lon), Number(me.latitude), Number(me.longitude))
          <= Number(sos.range_km)
      );

      if (nearby.length) {
        const { error: responderError } = await db.from('sos_responders').upsert(
          nearby.map((sos: any) => ({ sos_id: sos.id, responder_id: uid, status: 'alerted' })),
          { onConflict: 'sos_id,responder_id', ignoreDuplicates: true }
        );
        if (responderError) throw responderError;
      }

      const { data: rows = [], error } = await db.from('sos_responders')
        .select('status,sos_sessions!inner(id,victim_id,victim_lat,victim_lon,message,image_url,image_mime_type,range_km,status,users!sos_sessions_victim_id_fkey(id,name))')
        .eq('responder_id', uid).in('status', ['alerted', 'responding']);
      if (error) throw error;
      const alerts = await Promise.all(rows.filter((row: any) => row.sos_sessions?.status === 'active').map(async (row: any) => {
        const sos = row.sos_sessions, victim = sos.users;
        const location = { lat: Number(sos.victim_lat), lon: Number(sos.victim_lon) };
        return {
          sosId: sos.id,
          victim: { id: victim?.id || sos.victim_id, name: victim?.name || 'Someone nearby' },
          message: sos.message,
          imageUrl: await signedImageUrl(sos.image_url),
          mediaType: mediaType(sos.image_mime_type),
          location,
          distance: distanceKm(location.lat, location.lon, Number(me.latitude), Number(me.longitude)),
          range: Number(sos.range_km),
          responderStatus: row.status,
        };
      }));
      return json({ alerts });
    }
    if (/^\/sos\/\d+$/.test(p)) {
      const { data, error } = await db.from('sos_sessions').select('*,sos_responders(*)').eq('id', Number(p.split('/').pop())).single();
      if (error) throw error;
      return json({ sos: data ? { ...data, imageUrl: await signedImageUrl(data.image_url), mediaType: mediaType(data.image_mime_type) } : data });
    }
    if (/^\/sos\/\d+\/(respond|withdraw|arrived|end)$/.test(p) && req.method === 'POST') { const parts = p.split('/'), id = Number(parts[2]), action = parts[3]; if (action === 'end') await db.from('sos_sessions').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', id).eq('victim_id', uid); else await db.from('sos_responders').upsert({ sos_id: id, responder_id: uid, status: action === 'respond' ? 'responding' : action === 'arrived' ? 'arrived' : 'withdrawn', responded_at: new Date().toISOString() }, { onConflict: 'sos_id,responder_id' }); return json({ success: true }); }
    if (/^\/sos\/\d+\/messages$/.test(p)) {
      const sosId = Number(p.split('/')[2]);
      if (!Number.isInteger(sosId)) return fail('Invalid SOS');
      if (!await sosParticipant(sosId, uid)) return fail('You are not part of this SOS', 403);
      if (req.method === 'GET') {
        const { data: messages = [], error } = await db.from('sos_messages')
          .select('id,sos_id,sender_id,body,created_at,users!sos_messages_sender_id_fkey(name)')
          .eq('sos_id', sosId).order('created_at', { ascending: true }).limit(100);
        if (error) throw error;
        return json({ messages: messages.map((message: any) => ({
          id: message.id, sosId: message.sos_id, senderId: message.sender_id,
          senderName: message.users?.name || 'Participant', body: message.body,
          createdAt: message.created_at,
        })) });
      }
      if (req.method === 'POST') {
        const body = String(input.body || '').trim();
        if (!body) return fail('Message cannot be empty');
        if (body.length > 500) return fail('Message must be 500 characters or less');
        const { data: message, error } = await db.from('sos_messages')
          .insert({ sos_id: sosId, sender_id: uid, body }).select('id,sos_id,sender_id,body,created_at,users!sos_messages_sender_id_fkey(name)').single();
        if (error) throw error;
        return json({ message: {
          id: message.id, sosId: message.sos_id, senderId: message.sender_id,
          senderName: message.users?.name || 'Participant', body: message.body,
          createdAt: message.created_at,
        } });
      }
    }
    if (p === '/history') {
      const { data = [], error } = await db.from('sos_sessions')
        .select('*,sos_responders(id,responder_id,status,users!sos_responders_responder_id_fkey(id,name,latitude,longitude))')
        .eq('victim_id', uid)
        .order('started_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      const history = await Promise.all(data.map(async (event: any) => ({
        ...event,
        imageUrl: await signedImageUrl(event.image_url),
        mediaType: mediaType(event.image_mime_type),
        responders: (event.sos_responders || []).map((row: any) => ({
          id: row.users?.id || row.responder_id,
          name: row.users?.name || 'Responder',
          status: row.status,
          latitude: row.users?.latitude ?? null,
          longitude: row.users?.longitude ?? null,
        })),
      })));
      return json({ history });
    }
    if (p === '/timer' && req.method === 'GET') { const { data } = await db.from('safety_timers').select('*').eq('user_id', uid).eq('status', 'running').maybeSingle(); return json({ timer: data }); }
    if (p === '/timer/start' && req.method === 'POST') {
      const requestedSeconds = Number(input.seconds);
      const seconds = Number.isFinite(requestedSeconds)
        ? Math.min(86400, Math.max(1, Math.round(requestedSeconds)))
        : Math.min(86400, Math.max(60, (Number(input.minutes) || 10) * 60));
      const { data, error } = await db.from('safety_timers').insert({
        user_id: uid, note: String(input.note || ''),
        expires_at: new Date(Date.now() + seconds * 1000).toISOString(), status: 'running',
      }).select().single();
      if (error) throw error;
      return json({ timer: data });
    }
    if (p === '/timer/expire' && req.method === 'POST') {
      const { data: timer, error: timerError } = await db.from('safety_timers')
        .select('*').eq('user_id', uid).eq('status', 'running').lte('expires_at', new Date().toISOString()).maybeSingle();
      if (timerError) throw timerError;
      if (!timer) return json({ expired: false, timer: null });
      const { data: updated, error: updateError } = await db.from('safety_timers')
        .update({ status: 'expired' }).eq('id', timer.id).eq('status', 'running').select().maybeSingle();
      if (updateError) throw updateError;
      if (!updated) return json({ expired: false, timer: null });
      const { data: user, error: userError } = await db.from('users')
        .select('latitude,longitude').eq('id', uid).maybeSingle();
      if (userError) throw userError;
      const lat = Number(user?.latitude) || 0, lon = Number(user?.longitude) || 0;
      const { data: sos, error: sosError } = await db.from('sos_sessions').insert({
        victim_id: uid, victim_lat: lat, victim_lon: lon,
        message: timer.note || 'My safety timer expired. Please check on me.',
        range_km: 2, status: 'active', share_token: crypto.randomUUID().replaceAll('-', ''),
      }).select().single();
      if (sosError) throw sosError;
      const { data: candidates, error: candidateError } = await db.from('users')
        .select('id,latitude,longitude').neq('id', uid).not('latitude', 'is', null).not('longitude', 'is', null);
      if (candidateError) throw candidateError;
      const targets = (candidates || []).filter((candidate: any) =>
        distanceKm(lat, lon, Number(candidate.latitude), Number(candidate.longitude)) <= 2
      );
      if (targets.length) {
        const { error: responderError } = await db.from('sos_responders').upsert(
          targets.map((candidate: any) => ({ sos_id: sos.id, responder_id: candidate.id, status: 'alerted' })),
          { onConflict: 'sos_id,responder_id', ignoreDuplicates: true }
        );
        if (responderError) throw responderError;
      }
      return json({ expired: true, timer: null, sosId: sos.id, alerted: targets.length });
    }
    if ((p === '/timer/checkin' || p === '/timer/cancel') && req.method === 'POST') { await db.from('safety_timers').update({ status: p.endsWith('cancel') ? 'cancelled' : 'checked_in' }).eq('user_id', uid).eq('status', 'running'); return json({ success: true }); }
    if (p === '/user/push-token' && req.method === 'POST') { await db.from('users').update({ push_token: String(input.token || '').slice(0, 300) }).eq('id', uid); return json({ success: true }); }
    if (p === '/profile/stats') { const { count } = await db.from('sos_sessions').select('*', { count: 'exact', head: true }).eq('victim_id', uid); return json({ totalSOS: count || 0 }); }
    if (p === '/nearby') { const lat = Number(input.lat), lon = Number(input.lon), range = Math.min(10, Math.max(.1, Number(input.range) || 2)); const { data = [] } = await db.from('users').select('id,name,latitude,longitude').not('latitude', 'is', null).neq('id', uid); return json({ users: data.filter((x: any) => Math.abs(x.latitude - lat) < range / 90 && Math.abs(x.longitude - lon) < range / 90).map((x: any) => ({ id: x.id, name: x.name, distance: 0 })), range }); }
    if (p === '/nearby/help') {
      const lat = Number(input.lat), lon = Number(input.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return fail('Valid location required', 400);
      return json({
        places: [
          { id: 'emergency-police', name: 'Police emergency line', kind: 'police', lat, lon, distance: 0, address: 'Dial 112 for immediate help', phone: '112', fallback: true },
          { id: 'emergency-ambulance', name: 'Ambulance emergency line', kind: 'hospital', lat, lon, distance: 0, address: 'Dial 108 for medical help', phone: '108', fallback: true },
        ],
        hotlines: [{ label: 'Emergency', number: '112', primary: true }, { label: 'Ambulance', number: '108' }],
        cached: false,
        failed: true,
        fallback: true,
      });
    }
    if (/^\/sos\/\d+\/image$/.test(p) && req.method === 'POST') { const id = Number(p.split('/')[2]), image = input.image; if (!image?.dataUri) return fail('Media required'); const m = /^data:([^;]+);base64,(.+)$/s.exec(image.dataUri); if (!m) return fail('Invalid media'); const mime = m[1].toLowerCase(); if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'video/mp4', 'video/quicktime', 'video/3gpp'].includes(mime)) return fail('Unsupported media type'); const bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0)); const maxBytes = mime.startsWith('video/') ? 20 * 1024 * 1024 : 5 * 1024 * 1024; if (bytes.byteLength > maxBytes) return fail(mime.startsWith('video/') ? 'Video must be 20 MB or smaller' : 'Image must be 5 MB or smaller'); const key = 'sos/' + crypto.randomUUID() + '.' + mediaExtension(mime); const up = await db.storage.from('sos-media').upload(key, bytes, { contentType: mime, upsert: false }); if (up.error) throw up.error; await db.from('sos_sessions').update({ image_url: key, image_mime_type: mime, image_name: String(image.fileName || key) }).eq('id', id).eq('victim_id', uid); return json({ success: true, imageUrl: key, mediaType: mediaType(mime) }); }
    if (p === '/timer/extend' && req.method === 'POST') { const mins = Math.min(1440, Math.max(1, Number(input.minutes) || 10)); const { data } = await db.from('safety_timers').select('*').eq('user_id', uid).eq('status', 'running').maybeSingle(); if (!data) return fail('No running timer', 404); const until = new Date(new Date(data.expires_at).getTime() + mins * 60000).toISOString(); const { data: timer, error } = await db.from('safety_timers').update({ expires_at: until }).eq('id', data.id).select().single(); if (error) throw error; return json({ success: true, timer }); }
    if (p === '/notifications/send' && req.method === 'POST') { if (req.headers.get('x-job-secret') !== serviceKey) return fail('Unauthorized', 401); const messages = Array.isArray(input.messages) ? input.messages : []; const response = await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(messages.map((m: any) => ({ to: m.to, title: m.title || 'RESQORA alert', body: m.body || 'Someone nearby needs help', data: m.data || {}, sound: 'default', priority: 'high' }))) }); return json({ sent: messages.length, result: await response.json() }); }
    if (p === '/jobs/timers' && req.method === 'POST') { if (req.headers.get('x-job-secret') !== serviceKey) return fail('Unauthorized', 401); const { data = [] } = await db.from('safety_timers').select('*').eq('status', 'running').lte('expires_at', new Date().toISOString()); for (const timer of data) { await db.from('safety_timers').update({ status: 'expired' }).eq('id', timer.id); await db.from('sos_sessions').insert({ victim_id: timer.user_id, victim_lat: 0, victim_lon: 0, message: timer.note || 'My safety timer expired. Please check on me.', range_km: 2, status: 'active' }); } return json({ expired: data.length }); }
    return fail('Route not found', 404);
  } catch (e) { const err = e as any; console.error(e); return fail(err?.message || 'Request failed', err?.status || 500); }
});
