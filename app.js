/* 华南投放城市 & 区县 —— 交互地图 */
(function () {
  'use strict';

  var C = {
    on: '#38B6FF', off: '#E4E7EB', nodata: '#F5F6F8',
    onHi: '#0EA5E9', border: '#FFFFFF', borderDim: '#CBD5E1'
  };
  var GEO = 'https://geo.datav.aliyun.com/areas_v3/bound/';
  var GEO2 = 'https://geo.datav.aliyun.com/areas_v2/bound/';

  var DB = null, META = null, chart = null;
  var view = { level: 0, prov: null, city: null };
  var geoCache = {}, registered = {};
  var dirty = {};           // adcode -> record（未提交的改动）
  var remoteSha = null;
  var cfg = load('hn_cfg', { owner: '', repo: '', branch: 'main', token: '', path: 'placements.json' });

  /* ---------- 存储 ---------- */
  function load(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } }
  function save(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

  /* ---------- 工具 ---------- */
  function $(s) { return document.querySelector(s); }
  function el(t, c, h) { var e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; }
  function fmt(n) { return n == null ? '—' : n.toLocaleString('zh-CN'); }
  function wan(n) { return n == null ? '—' : (n / 10000).toFixed(1) + ' 万'; }

  function recsOf(f) { return DB.records.filter(f); }
  function byAdcode(ad) { return DB.records.find(function (r) { return r.adcode === ad; }); }

  /* ---------- GeoJSON ---------- */
  function fetchGeo(code, useV2) {
    var key = code + (useV2 ? '_v2' : '');
    if (geoCache[key]) return Promise.resolve(geoCache[key]);
    var url = (useV2 ? GEO2 : GEO) + code + '_full.json';
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('geo ' + code + ' ' + r.status);
      return r.json();
    }).then(function (j) { geoCache[key] = j; return j; });
  }
  function reg(name, geo) {
    if (registered[name]) return;
    echarts.registerMap(name, geo); registered[name] = 1;
  }

  /* ---------- 渲染 ---------- */
  function render() {
    setBread();
    if (view.level === 0) return renderChina();
    if (view.level === 1) return renderProv();
    return renderCity();
  }

  function baseOpt(mapName, data, extra) {
    var o = {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item', formatter: extra && extra.tip, borderWidth: 0,
        backgroundColor: 'rgba(15,23,42,.92)', textStyle: { color: '#fff', fontSize: 12 },
        extraCssText: 'border-radius:8px;padding:10px 12px;box-shadow:0 8px 24px rgba(0,0,0,.18)' },
      series: [{
        type: 'map', map: mapName, roam: true, zoom: extra && extra.zoom || 1.1,
        scaleLimit: { min: .8, max: 12 },
        label: { show: !!(extra && extra.label), fontSize: 10, color: '#475569' },
        emphasis: { label: { show: true, color: '#0F172A', fontWeight: 600 },
          itemStyle: { areaColor: C.onHi, borderColor: '#fff', borderWidth: 1.5 } },
        select: { disabled: true },
        itemStyle: { borderColor: C.border, borderWidth: .8, areaColor: C.nodata },
        data: data
      }]
    };
    if (extra && extra.bubble) o.series.push(extra.bubble);
    if (extra && extra.geo) o.geo = extra.geo;
    return o;
  }

  function renderChina() {
    fetchGeo('100000').then(function (g) {
      reg('china', g);
      var data = Object.keys(DB.provs).map(function (ad) {
        var p = DB.provs[ad];
        return { name: p.name, value: p.on,
          itemStyle: { areaColor: p.status === 'on' ? C.on : C.off },
          _p: p };
      });
      chart.setOption(baseOpt('china', data, {
        zoom: 1.25, label: false,
        tip: function (d) {
          var p = d.data && d.data._p;
          if (!p) return '<b>' + d.name + '</b><br/><span style="opacity:.6">非投放范围</span>';
          return '<b>' + p.name + '</b><br/>投放城市 ' + p.citiesOn + '/' + p.cities +
            '<br/>投放区县 ' + p.on + '/' + p.total + '<br/><span style="opacity:.6">点击下钻</span>';
        }
      }), true);
      chart.off('click'); chart.on('click', function (e) {
        var p = e.data && e.data._p; if (!p) return;
        view = { level: 1, prov: p.adcode, city: null }; render();
      });
      stats(Object.keys(DB.provs).length + ' 省', DB.records.length, DB.meta_on);
      listPanel(DB.records);
    });
  }

  function renderProv() {
    var pv = DB.provs[view.prov];
    fetchGeo(view.prov).then(function (g) {
      reg('p' + view.prov, g);
      var mine = {};
      Object.keys(DB.cities).forEach(function (ad) {
        var c = DB.cities[ad]; if (c.provAdcode === view.prov) mine[c.name] = c;
      });
      var data = g.features.map(function (f) {
        var nm = f.properties.name;
        var c = mine[nm] || mine[nm.replace('市', '')] ||
          Object.keys(mine).map(function (k) { return mine[k]; })
            .find(function (x) { return nm.indexOf(x.name) === 0 || x.name.indexOf(nm.replace('市', '')) === 0; });
        return { name: nm, itemStyle: { areaColor: c ? (c.status === 'on' ? C.on : C.off) : C.nodata }, _c: c };
      });
      chart.setOption(baseOpt('p' + view.prov, data, {
        label: true,
        tip: function (d) {
          var c = d.data && d.data._c;
          if (!c) return '<b>' + d.name + '</b><br/><span style="opacity:.6">未纳入投放清单</span>';
          var unit = c.level === 'town' ? '镇街' : '区县';
          return '<b>' + c.name + '</b><br/>投放' + unit + ' ' + c.on + '/' + c.total +
            '<br/>覆盖常住人口 ' + wan(c.popOn) + (c.cityPop ? ' / 全市 ' + wan(c.cityPop) : '') +
            '<br/><span style="opacity:.6">点击查看' + unit + '</span>';
        }
      }), true);
      chart.off('click'); chart.on('click', function (e) {
        var c = e.data && e.data._c; if (!c) return;
        view = { level: 2, prov: view.prov, city: c.adcode }; render();
      });
      var rs = recsOf(function (r) { return r.provAdcode === view.prov; });
      stats(pv.name, rs.length, rs.filter(onf).length);
      listPanel(rs);
    });
  }

  function renderCity() {
    var c = DB.cities[view.city];
    var rs = recsOf(function (r) { return r.cityAdcode === view.city; });
    var isTown = c.level === 'town';
    var p = isTown ? fetchGeo(view.city, true) : fetchGeo(view.city);
    p.then(function (g) {
      reg('c' + view.city + (isTown ? 'v2' : ''), g);
      var mapName = 'c' + view.city + (isTown ? 'v2' : '');
      if (isTown) {
        // 直筒子市：市域轮廓 + 镇街气泡点
        var pts = rs.map(function (r) {
          return { name: r.name, value: [r.lng, r.lat],
            itemStyle: { color: r.status === 'on' ? C.on : '#94A3B8',
              borderColor: '#fff', borderWidth: 1.5,
              shadowBlur: 6, shadowColor: 'rgba(0,0,0,.15)' }, _r: r };
        });
        chart.setOption({
          backgroundColor: 'transparent',
          tooltip: { trigger: 'item', borderWidth: 0,
            backgroundColor: 'rgba(15,23,42,.92)', textStyle: { color: '#fff', fontSize: 12 },
            extraCssText: 'border-radius:8px;padding:10px 12px',
            formatter: function (d) {
              var r = d.data && d.data._r; if (!r) return d.name;
              return '<b>' + r.name + '</b><br/>' +
                (r.status === 'on' ? '<span style="color:#38B6FF">● 投放中</span>' : '<span style="opacity:.65">● 未投放</span>') +
                (r.remark ? '<br/>备注：' + r.remark : '') +
                '<br/><span style="opacity:.6">点击编辑</span>';
            } },
          geo: { map: mapName, roam: true, zoom: 1.05,
            itemStyle: { areaColor: '#F1F5F9', borderColor: C.borderDim, borderWidth: 1 },
            emphasis: { disabled: true } },
          series: [{ type: 'scatter', coordinateSystem: 'geo', symbolSize: 15, data: pts,
            label: { show: true, position: 'right', fontSize: 10, color: '#475569',
              formatter: function (d) { return d.data._r.short; } },
            emphasis: { scale: 1.5, label: { fontWeight: 700, color: '#0F172A' } } }]
        }, true);
        chart.off('click'); chart.on('click', function (e) {
          if (e.data && e.data._r) openEdit(e.data._r);
        });
      } else {
        var byName = {};
        rs.forEach(function (r) { byName[r.official || r.name] = r; });
        var data = g.features.map(function (f) {
          var nm = f.properties.name, r = byName[nm];
          return { name: nm, itemStyle: { areaColor: r ? (r.status === 'on' ? C.on : C.off) : C.nodata }, _r: r };
        });
        chart.setOption(baseOpt(mapName, data, {
          label: true, zoom: 1.05,
          tip: function (d) {
            var r = d.data && d.data._r;
            if (!r) return '<b>' + d.name + '</b><br/><span style="opacity:.6">未纳入清单</span>';
            return '<b>' + (r.official || r.name) + '</b><br/>' +
              (r.status === 'on' ? '<span style="color:#38B6FF">● 投放中</span>' : '<span style="opacity:.65">● 未投放</span>') +
              '<br/>常住人口 <b>' + fmt(r.pop) + '</b> 人' + (r.pop ? '（' + wan(r.pop) + '）' : '') +
              (r.area ? '<br/>面积 ' + r.area + ' km²' : '') +
              (r.pop && r.area ? '<br/>密度 ' + Math.round(r.pop / r.area) + ' 人/km²' : '') +
              (r.remark ? '<br/>备注：' + r.remark : '') +
              '<br/><span style="opacity:.6">点击编辑</span>';
          }
        }), true);
        chart.off('click'); chart.on('click', function (e) {
          if (e.data && e.data._r) openEdit(e.data._r);
        });
      }
      stats(c.name, rs.length, rs.filter(onf).length, isTown ? null : rs.reduce(function (a, r) { return a + (r.status === 'on' ? (r.pop || 0) : 0); }, 0));
      listPanel(rs);
    }).catch(function (err) {
      $('#map').innerHTML = '<div class="err">地图数据加载失败：' + err.message + '<br/>该市可能无下级边界数据</div>';
    });
  }

  function onf(r) { return r.status === 'on'; }

  /* ---------- 面板 ---------- */
  function stats(scope, total, on, popOn) {
    var box = $('#kpi'); box.innerHTML = '';
    var items = [
      ['范围', scope], ['单元总数', total],
      ['投放中', on, C.on], ['未投放', total - on, '#94A3B8'],
      ['投放率', total ? Math.round(on / total * 100) + '%' : '—']
    ];
    if (popOn != null) items.push(['覆盖常住人口', wan(popOn)]);
    items.forEach(function (it) {
      var d = el('div', 'kpi');
      d.innerHTML = '<span class="kl">' + it[0] + '</span><span class="kv" ' +
        (it[2] ? 'style="color:' + it[2] + '"' : '') + '>' + it[1] + '</span>';
      box.appendChild(d);
    });
  }

  function setBread() {
    var b = $('#bread'); b.innerHTML = '';
    var path = [{ t: '全国', f: function () { view = { level: 0 }; render(); } }];
    if (view.prov) path.push({ t: DB.provs[view.prov].name, f: function () { view = { level: 1, prov: view.prov }; render(); } });
    if (view.city) path.push({ t: DB.cities[view.city].name, f: null });
    path.forEach(function (p, i) {
      if (i) b.appendChild(el('span', 'sep', '›'));
      var a = el('a', 'crumb' + (p.f ? '' : ' cur'), p.t);
      if (p.f) a.onclick = p.f;
      b.appendChild(a);
    });
  }

  function listPanel(rs) {
    var q = ($('#q').value || '').trim();
    var f = $('#flt').value;
    var list = rs.filter(function (r) {
      if (f === 'on' && r.status !== 'on') return false;
      if (f === 'off' && r.status !== 'off') return false;
      if (q && (r.name + r.city + (r.remark || '')).indexOf(q) < 0) return false;
      return true;
    });
    var box = $('#list'); box.innerHTML = '';
    $('#lcount').textContent = list.length + ' 条';
    list.forEach(function (r) {
      var d = el('div', 'row' + (dirty[r.adcode] ? ' dirty' : ''));
      d.innerHTML =
        '<span class="dot" style="background:' + (r.status === 'on' ? C.on : '#CBD5E1') + '"></span>' +
        '<span class="rn">' + r.name + '</span>' +
        '<span class="rc">' + r.city + '</span>' +
        '<span class="rp">' + (r.pop ? wan(r.pop) : (r.level === 'town' ? '镇街' : '—')) + '</span>';
      d.onclick = function () { openEdit(r); };
      box.appendChild(d);
    });
  }

  /* ---------- 编辑 ---------- */
  var editing = null;
  function openEdit(r) {
    editing = r;
    $('#eName').textContent = r.official || r.name;
    $('#eSub').textContent = r.prov + ' · ' + r.city + ' · ' + (r.level === 'town' ? '镇街' : '区县') + ' · ' + r.adcode;
    $('#ePop').innerHTML = r.level === 'town'
      ? '<span class="muted">镇街级无普查人口数据</span>'
      : '常住人口 <b>' + fmt(r.pop) + '</b> 人' + (r.pop ? '（' + wan(r.pop) + '）' : '') +
        (r.area ? ' · 面积 ' + r.area + ' km²' : '') +
        (r.pop && r.area ? ' · 密度 ' + Math.round(r.pop / r.area) + ' 人/km²' : '');
    $('#eStatus').value = r.status;
    $('#eRemark').value = r.remark || '';
    $('#eEvent').textContent = r.event || '（无）';
    $('#drawer').classList.add('open');
  }
  function closeEdit() { $('#drawer').classList.remove('open'); editing = null; }

  function applyEdit() {
    if (!editing) return;
    var ns = $('#eStatus').value, nr = $('#eRemark').value;
    if (ns === editing.status && nr === (editing.remark || '')) { closeEdit(); return; }
    editing.status = ns; editing.remark = nr;
    editing._m = new Date().toISOString();
    dirty[editing.adcode] = editing;
    recalc();
    save('hn_draft', { records: DB.records, ts: Date.now() });
    closeEdit(); render(); flagDirty();
  }

  function recalc() {
    Object.keys(DB.cities).forEach(function (ad) {
      var c = DB.cities[ad], rs = recsOf(function (r) { return r.cityAdcode === ad; });
      c.on = rs.filter(onf).length;
      c.popOn = rs.reduce(function (a, r) { return a + (r.status === 'on' ? (r.pop || 0) : 0); }, 0);
      c.status = c.on > 0 ? 'on' : 'off';
    });
    Object.keys(DB.provs).forEach(function (ad) {
      var p = DB.provs[ad];
      var cs = Object.keys(DB.cities).map(function (k) { return DB.cities[k]; })
        .filter(function (c) { return c.provAdcode === ad; });
      p.citiesOn = cs.filter(function (c) { return c.status === 'on'; }).length;
      p.on = cs.reduce(function (a, c) { return a + c.on; }, 0);
      p.status = p.citiesOn > 0 ? 'on' : 'off';
    });
    DB.meta_on = DB.records.filter(onf).length;
  }

  function flagDirty() {
    var n = Object.keys(dirty).length;
    $('#dirty').textContent = n ? n + ' 项待提交' : '已同步';
    $('#dirty').className = 'badge ' + (n ? 'warn' : 'ok');
    $('#btnPush').disabled = !n;
  }

  /* ---------- GitHub 同步 ---------- */
  function api(path, opt) {
    opt = opt || {};
    opt.headers = Object.assign({
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + cfg.token,
      'X-GitHub-Api-Version': '2022-11-28'
    }, opt.headers || {});
    return fetch('https://api.github.com' + path, opt).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error((j.message || r.status) + '');
        return j;
      });
    });
  }
  function b64(s) { return btoa(String.fromCharCode.apply(null, new TextEncoder().encode(s))); }
  function unb64(s) { return new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), function (c) { return c.charCodeAt(0); })); }

  function pull() {
    if (!cfg.token) return toast('请先配置 GitHub 连接', 1);
    toast('拉取中…');
    api('/repos/' + cfg.owner + '/' + cfg.repo + '/contents/' + cfg.path + '?ref=' + cfg.branch)
      .then(function (j) {
        remoteSha = j.sha;
        var d = JSON.parse(unb64(j.content));
        DB.records = d.records; DB.cities = d.cities; DB.provs = d.provs;
        dirty = {}; recalc(); render(); flagDirty();
        localStorage.removeItem('hn_draft');
        toast('已拉取云端最新版本');
      }).catch(function (e) { toast('拉取失败：' + e.message, 1); });
  }

  function push() {
    if (!cfg.token) return toast('请先配置 GitHub 连接', 1);
    var n = Object.keys(dirty).length;
    var msg = prompt('提交说明（会成为一条 commit，可在历史中回溯）',
      '更新 ' + n + ' 项投放状态');
    if (msg == null) return;
    toast('提交中…');
    var body = JSON.stringify({ records: DB.records, cities: DB.cities, provs: DB.provs }, null, 1);
    var payload = { message: msg, content: b64(body), branch: cfg.branch };
    if (remoteSha) payload.sha = remoteSha;
    api('/repos/' + cfg.owner + '/' + cfg.repo + '/contents/' + cfg.path, {
      method: 'PUT', body: JSON.stringify(payload)
    }).then(function (j) {
      remoteSha = j.content.sha; dirty = {}; flagDirty(); render();
      localStorage.removeItem('hn_draft');
      toast('已提交 · ' + j.commit.sha.slice(0, 7));
      loadHistory();
    }).catch(function (e) {
      if ((e.message || '').indexOf('does not match') >= 0 || (e.message || '').indexOf('409') >= 0) {
        toast('冲突：云端已被他人更新，请先「拉取」再重新提交', 1);
      } else toast('提交失败：' + e.message, 1);
    });
  }

  function loadHistory() {
    if (!cfg.token) return;
    api('/repos/' + cfg.owner + '/' + cfg.repo + '/commits?path=' + cfg.path + '&sha=' + cfg.branch + '&per_page=20')
      .then(function (cs) {
        var box = $('#hist'); box.innerHTML = '';
        cs.forEach(function (c) {
          var d = el('div', 'hrow');
          var t = new Date(c.commit.author.date);
          d.innerHTML = '<div class="hm">' + (c.commit.message || '').split('\n')[0] + '</div>' +
            '<div class="hs">' + c.commit.author.name + ' · ' +
            t.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) +
            ' · <code>' + c.sha.slice(0, 7) + '</code></div>';
          d.onclick = function () {
            if (!confirm('回滚到该版本？\n\n' + c.commit.message + '\n\n当前未提交的改动会丢失。')) return;
            api('/repos/' + cfg.owner + '/' + cfg.repo + '/contents/' + cfg.path + '?ref=' + c.sha)
              .then(function (j) {
                var dd = JSON.parse(unb64(j.content));
                DB.records = dd.records; DB.cities = dd.cities; DB.provs = dd.provs;
                Object.keys(DB.records).forEach(function () {});
                dirty = {}; DB.records.forEach(function (r) { dirty[r.adcode] = r; });
                recalc(); render(); flagDirty();
                toast('已载入 ' + c.sha.slice(0, 7) + ' 的内容，点「提交」生效');
              });
          };
          box.appendChild(d);
        });
      }).catch(function (e) { $('#hist').innerHTML = '<div class="muted">历史加载失败：' + e.message + '</div>'; });
  }

  /* ---------- 导出 ---------- */
  function exportCSV() {
    var h = ['省份', '城市', '区县/镇街', '层级', 'adcode', '投放状态', '常住人口', '面积km2', '备注', '事件记录'];
    var lines = [h.join(',')];
    DB.records.forEach(function (r) {
      lines.push([r.prov, r.city, r.official || r.name, r.level === 'town' ? '镇街' : '区县',
        r.adcode, r.status === 'on' ? '投放中' : '未投放', r.pop || '', r.area || '',
        (r.remark || '').replace(/,/g, '，'), (r.event || '').replace(/,/g, '，')].join(','));
    });
    var blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = el('a'); a.href = URL.createObjectURL(blob);
    a.download = '华南投放区县_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
  }

  function toast(m, err) {
    var t = $('#toast'); t.textContent = m;
    t.className = 'toast show' + (err ? ' err' : '');
    clearTimeout(t._t); t._t = setTimeout(function () { t.className = 'toast'; }, 3200);
  }

  /* ---------- 配置弹窗 ---------- */
  function openCfg() {
    $('#cOwner').value = cfg.owner; $('#cRepo').value = cfg.repo;
    $('#cBranch').value = cfg.branch; $('#cToken').value = cfg.token;
    $('#modal').classList.add('open');
  }
  function saveCfg() {
    cfg.owner = $('#cOwner').value.trim(); cfg.repo = $('#cRepo').value.trim();
    cfg.branch = $('#cBranch').value.trim() || 'main'; cfg.token = $('#cToken').value.trim();
    save('hn_cfg', cfg); $('#modal').classList.remove('open');
    toast('已保存连接配置'); loadHistory();
  }

  /* ---------- 启动 ---------- */
  function loadJSON(p) {
    return fetch(p).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function firstOK(list) {
    var i = 0;
    function next() {
      if (i >= list.length) return Promise.reject(new Error('未找到 ' + list.join(' / ')));
      return loadJSON(list[i++]).catch(next);
    }
    return next();
  }
  Promise.all([
    firstOK(['data/placements.json', 'placements.json']),
    firstOK(['data/meta.json', 'meta.json'])
  ]).then(function (a) {
    DB = a[0]; META = a[1];
    var draft = load('hn_draft', null);
    if (draft && draft.records && draft.records.length === DB.records.length) {
      if (confirm('检测到本地有未提交的草稿（' + new Date(draft.ts).toLocaleString('zh-CN') + '）\n是否恢复？')) {
        DB.records = draft.records;
        DB.records.forEach(function (r) { if (r._m) dirty[r.adcode] = r; });
      } else localStorage.removeItem('hn_draft');
    }
    recalc();
    chart = echarts.init($('#map'), null, { renderer: 'canvas' });
    window.addEventListener('resize', function () { chart.resize(); });
    $('#q').oninput = function () { render(); };
    $('#flt').onchange = function () { render(); };
    $('#btnSave').onclick = applyEdit;
    $('#btnCancel').onclick = closeEdit;
    $('#btnCfg').onclick = openCfg;
    $('#btnCfgSave').onclick = saveCfg;
    $('#btnCfgClose').onclick = function () { $('#modal').classList.remove('open'); };
    $('#btnPull').onclick = pull;
    $('#btnPush').onclick = push;
    $('#btnCSV').onclick = exportCSV;
    $('#src').textContent = META.popSource;
    flagDirty(); render();
    if (cfg.token) loadHistory();
  }).catch(function (e) {
    document.body.innerHTML = '<div style="padding:40px;font:14px system-ui">数据加载失败：' + e.message +
      '<br><br>如果是本地双击打开，浏览器会拦截 fetch 本地文件。请用 <code>python3 -m http.server</code> 起个本地服务，或直接访问已部署的线上地址。</div>';
  });
})();
