(() => {
  'use strict'
  const svg = document.querySelector('#main-graph')
  const stage = document.querySelector('#graph-stage')
  const panel = document.querySelector('#detail-panel')
  const status = document.querySelector('#graph-status')
  const search = document.querySelector('#graph-search')
  const NS = 'http://www.w3.org/2000/svg'
  let data, nodes = [], edges = [], transform = { x: 0, y: 0, scale: 1 }, drag = null

  const el = (name, attrs = {}) => {
    const node = document.createElementNS(NS, name)
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value))
    return node
  }
  const textWidth = value => Math.max(76, Math.min(210, String(value).length * 8.2 + 35))
  const normalize = value => String(value || '').toLocaleLowerCase().replace(/\s+/g, '')

  function buildLayout() {
    nodes = []
    edges = []
    const columns = stage.clientWidth > 1050 ? 2 : 1
    const columnWidth = 520
    const columnHeights = Array(columns).fill(95)
    let row = 0
    data.categories.forEach((category, ci) => {
      const column = columnHeights.indexOf(Math.min(...columnHeights))
      const clusterHeight = Math.max(150, category.tags.length * 58)
      const categoryX = 145 + column * columnWidth
      const categoryY = columnHeights[column] + clusterHeight / 2
      const categoryNode = { id: `c-${ci}`, type: 'category', name: category.name, x: categoryX, y: categoryY, count: category.tags.length }
      nodes.push(categoryNode)
      category.tags.forEach((tagName, ti) => {
        const tagNode = { id: `t-${row++}`, type: 'tag', name: tagName, x: categoryX + 245, y: categoryY + (ti - (category.tags.length - 1) / 2) * 58, count: (data.tags[tagName] || []).length }
        nodes.push(tagNode)
        edges.push({ source: categoryNode, target: tagNode })
      })
      columnHeights[column] += clusterHeight + 85
    })
  }

  function draw() {
    svg.innerHTML = ''
    const group = el('g', { id: 'graph-world', transform: `translate(${transform.x} ${transform.y}) scale(${transform.scale})` })
    edges.forEach(edge => group.append(el('line', { class: 'edge', x1: edge.source.x, y1: edge.source.y, x2: edge.target.x, y2: edge.target.y })))
    nodes.forEach(node => {
      const width = textWidth(node.name)
      const groupNode = el('g', { class: `node node-${node.type}`, transform: `translate(${node.x - width / 2} ${node.y - 21})`, tabindex: '0', role: 'button', 'aria-label': `${node.type === 'category' ? '分类' : '标签'} ${node.name}` })
      groupNode.dataset.name = node.name
      groupNode.append(el('rect', { width, height: 42, rx: 11 }))
      const label = el('text', { x: 14, y: 20 })
      label.textContent = `${node.type === 'category' ? '▱' : '#'}  ${node.name}`
      groupNode.append(label)
      const count = el('text', { class: 'node-count', x: 14, y: 34 })
      count.textContent = node.type === 'category' ? `${node.count} 个标签` : `${node.count} 篇文章`
      groupNode.append(count)
      if (node.type === 'tag') {
        groupNode.addEventListener('click', event => { event.stopPropagation(); openTag(node.name) })
        groupNode.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') openTag(node.name) })
      }
      group.append(groupNode)
    })
    svg.append(group)
    applySearch()
  }

  function fitView() {
    if (!nodes.length) return
    const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y)
    const bounds = { minX: Math.min(...xs) - 140, maxX: Math.max(...xs) + 140, minY: Math.min(...ys) - 90, maxY: Math.max(...ys) + 90 }
    const scale = Math.min(.95, (stage.clientWidth - 50) / (bounds.maxX - bounds.minX), (stage.clientHeight - 50) / (bounds.maxY - bounds.minY))
    transform = { scale: Math.max(.24, scale), x: (stage.clientWidth - (bounds.minX + bounds.maxX) * scale) / 2, y: (stage.clientHeight - (bounds.minY + bounds.maxY) * scale) / 2 }
    draw()
  }

  function resetView() {
    transform = { x: 24, y: 28, scale: .78 }
    draw()
  }

  function focusNode(node) {
    transform.x = stage.clientWidth / 2 - node.x * transform.scale
    transform.y = stage.clientHeight / 2 - node.y * transform.scale
    draw()
  }

  function zoom(multiplier, clientX = stage.clientWidth / 2, clientY = stage.clientHeight / 2) {
    const next = Math.max(.22, Math.min(2.2, transform.scale * multiplier))
    const ratio = next / transform.scale
    transform.x = clientX - (clientX - transform.x) * ratio
    transform.y = clientY - (clientY - transform.y) * ratio
    transform.scale = next
    draw()
  }

  function openTag(tagName) {
    const posts = (data.tags[tagName] || []).map(index => data.posts[index]).filter(Boolean)
    const shown = posts.slice(0, 12)
    panel.classList.add('is-open')
    panel.innerHTML = `
      <header class="detail-head">
        <div class="detail-title-row"><h2>${escapeHtml(tagName)}</h2><button class="close-detail" type="button" aria-label="关闭">×</button></div>
        <div class="detail-meta"><i></i><span>标签 · ${posts.length} 篇文章</span></div>
      </header>
      <div class="mini-graph"><svg viewBox="0 0 380 240" aria-label="${escapeHtml(tagName)} 与文章的局部图谱"></svg></div>
      <section class="article-section"><h3>相关文章</h3><ul class="article-list">${posts.map(post => `<li><a href="${post.url}"><span class="article-icon">▧</span><span class="article-title">${escapeHtml(post.title)}</span><time class="article-date">${post.date}</time></a></li>`).join('')}</ul></section>`
    panel.querySelector('.close-detail').addEventListener('click', closePanel)
    drawMiniGraph(panel.querySelector('.mini-graph svg'), tagName, shown)
  }

  function drawMiniGraph(target, tagName, posts) {
    target.innerHTML = ''
    const center = { x: 78, y: 120 }
    const spacing = Math.min(38, 180 / Math.max(1, posts.length - 1))
    posts.forEach((post, index) => {
      const y = 120 + (index - (posts.length - 1) / 2) * spacing
      target.append(el('line', { class: 'mini-edge', x1: center.x + 28, y1: center.y, x2: 155, y2: y }))
      target.append(el('rect', { class: 'mini-post', x: 154, y: y - 13, width: 205, height: 26, rx: 8 }))
      const label = el('text', { class: 'mini-label', x: 164, y: y + 4 })
      label.textContent = post.title.length > 18 ? `${post.title.slice(0, 18)}…` : post.title
      target.append(label)
    })
    target.append(el('rect', { class: 'mini-center', x: 32, y: 104, width: 78, height: 32, rx: 9 }))
    const centerLabel = el('text', { class: 'mini-center-label', x: 71, y: 125, 'text-anchor': 'middle' })
    centerLabel.textContent = `# ${tagName.length > 7 ? `${tagName.slice(0, 7)}…` : tagName}`
    target.append(centerLabel)
  }

  function closePanel() {
    panel.classList.remove('is-open')
    panel.innerHTML = '<div class="empty-detail"><div class="empty-orbit" aria-hidden="true"><i></i><i></i><i></i></div><h2>选择一个标签</h2><p>点击主图中的标签，在这里查看它与文章之间的局部联系。</p></div>'
  }

  function applySearch() {
    const query = normalize(search.value)
    svg.querySelectorAll('.node').forEach(node => {
      const match = !query || normalize(node.dataset.name).includes(query)
      node.classList.toggle('is-dimmed', !match)
      node.classList.toggle('is-highlighted', !!query && match)
    })
    const matchedNode = nodes.find(node => normalize(node.name).includes(query))
    if (!query || matchedNode) return
    const post = data.posts.find(item => normalize(item.title).includes(query))
    if (post && post.tags.length) openTag(post.tags[0])
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]))
  }

  stage.addEventListener('wheel', event => { event.preventDefault(); const rect = stage.getBoundingClientRect(); zoom(event.deltaY < 0 ? 1.12 : .89, event.clientX - rect.left, event.clientY - rect.top) }, { passive: false })
  stage.addEventListener('pointerdown', event => { if (event.target.closest('.node') || event.target.closest('button')) return; drag = { x: event.clientX, y: event.clientY, tx: transform.x, ty: transform.y }; stage.classList.add('is-dragging'); stage.setPointerCapture(event.pointerId) })
  stage.addEventListener('pointermove', event => { if (!drag) return; transform.x = drag.tx + event.clientX - drag.x; transform.y = drag.ty + event.clientY - drag.y; draw() })
  stage.addEventListener('pointerup', () => { drag = null; stage.classList.remove('is-dragging') })
  search.addEventListener('input', () => {
    applySearch()
    const query = normalize(search.value)
    const matchedNode = query && nodes.find(node => normalize(node.name).includes(query))
    if (matchedNode) focusNode(matchedNode)
  })
  document.addEventListener('keydown', event => { if (event.key === '/' && document.activeElement !== search) { event.preventDefault(); search.focus() } if (event.key === 'Escape') closePanel() })
  document.querySelector('#zoom-in').addEventListener('click', () => zoom(1.2))
  document.querySelector('#zoom-out').addEventListener('click', () => zoom(.82))
  document.querySelector('#fit-view').addEventListener('click', fitView)
  document.querySelector('#reset-view').addEventListener('click', resetView)
  window.addEventListener('resize', () => { if (!data) return; buildLayout(); resetView() })

  fetch('/graph/data.json')
    .then(response => { if (!response.ok) throw new Error('图谱数据加载失败'); return response.json() })
    .then(payload => { data = payload; buildLayout(); status.remove(); resetView() })
    .catch(error => { status.textContent = error.message })
})()
