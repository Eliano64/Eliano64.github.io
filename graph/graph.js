(() => {
  'use strict'

  const svg = document.querySelector('#main-graph')
  const stage = document.querySelector('#graph-stage')
  const panel = document.querySelector('#detail-panel')
  const status = document.querySelector('#graph-status')
  const search = document.querySelector('#graph-search')
  const summary = document.querySelector('#graph-summary')
  const NS = 'http://www.w3.org/2000/svg'

  let data
  let nodes = []
  let edges = []
  let nodeById = new Map()
  let neighbours = new Map()
  let world
  let edgeLayer
  let nodeLayer
  let transform = { x: 0, y: 0, scale: 1 }
  let canvasDrag
  let nodeDrag
  let hoveredId
  let selectedId
  let searchMatches = new Set()
  let simulationFrame
  let simulationTicks = 0
  let layoutSeed = 0
  let hasInteracted = false

  const createSvg = (name, attrs = {}) => {
    const element = document.createElementNS(NS, name)
    Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value))
    return element
  }

  const normalize = value => String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')

  const hash = value => {
    let result = 2166136261
    for (const character of String(value)) {
      result ^= character.charCodeAt(0)
      result = Math.imul(result, 16777619)
    }
    return (result >>> 0) / 4294967295
  }

  function buildGraph () {
    const width = Math.max(stage.clientWidth, 680)
    const height = Math.max(stage.clientHeight, 560)
    const centerX = width / 2
    const centerY = height / 2
    const radiusX = Math.min(width * 0.3, 340)
    const radiusY = Math.min(height * 0.31, 230)
    const tagMap = new Map()

    nodes = []
    edges = []
    neighbours = new Map()

    data.categories.forEach((category, index) => {
      const angle = (Math.PI * 2 * index) / data.categories.length - Math.PI / 2
      nodes.push({
        id: `category:${category.name}`,
        type: 'category',
        name: category.name,
        count: category.tags.length,
        x: centerX + Math.cos(angle) * radiusX,
        y: centerY + Math.sin(angle) * radiusY,
        vx: 0,
        vy: 0
      })
    })

    nodeById = new Map(nodes.map(node => [node.id, node]))

    data.categories.forEach(category => {
      const categoryNode = nodeById.get(`category:${category.name}`)
      category.tags.forEach(tagName => {
        let tagNode = tagMap.get(tagName)
        if (!tagNode) {
          const jitterAngle = hash(`${tagName}:${layoutSeed}`) * Math.PI * 2
          const jitterRadius = 42 + hash(`${layoutSeed}:${tagName}`) * 95
          tagNode = {
            id: `tag:${tagName}`,
            type: 'tag',
            name: tagName,
            count: (data.tags[tagName] || []).length,
            x: categoryNode.x + Math.cos(jitterAngle) * jitterRadius,
            y: categoryNode.y + Math.sin(jitterAngle) * jitterRadius,
            vx: 0,
            vy: 0
          }
          tagMap.set(tagName, tagNode)
          nodes.push(tagNode)
        } else {
          tagNode.x = (tagNode.x + categoryNode.x) / 2
          tagNode.y = (tagNode.y + categoryNode.y) / 2
        }

        edges.push({
          id: `${categoryNode.id}|${tagNode.id}`,
          source: categoryNode,
          target: tagNode
        })
      })
    })

    nodeById = new Map(nodes.map(node => [node.id, node]))
    nodes.forEach(node => neighbours.set(node.id, new Set()))
    edges.forEach(edge => {
      neighbours.get(edge.source.id).add(edge.target.id)
      neighbours.get(edge.target.id).add(edge.source.id)
    })
  }

  function createGraphElements () {
    svg.innerHTML = ''
    world = createSvg('g', { class: 'graph-world' })
    edgeLayer = createSvg('g', { class: 'edge-layer' })
    nodeLayer = createSvg('g', { class: 'node-layer' })

    edges.forEach(edge => {
      const line = createSvg('line', { class: 'edge' })
      line.dataset.id = edge.id
      edge.element = line
      edgeLayer.append(line)
    })

    nodes.forEach(node => {
      const group = createSvg('g', {
        class: `node node-${node.type}`,
        tabindex: '0',
        role: 'button',
        'aria-label': `${node.type === 'category' ? '分类' : '标签'} ${node.name}，${node.count}${node.type === 'category' ? ' 个标签' : ' 篇文章'}`
      })
      const hitArea = createSvg('circle', { class: 'node-hit', r: node.type === 'category' ? 22 : 18 })
      const dot = createSvg('circle', { class: 'node-dot', r: node.type === 'category' ? 8.5 : 5.5 })
      const label = createSvg('text', { class: 'node-label', x: node.type === 'category' ? 14 : 11, y: 4 })
      label.textContent = node.name
      const title = createSvg('title')
      title.textContent = `${node.name} · ${node.count}${node.type === 'category' ? ' 个标签' : ' 篇文章'}`

      group.dataset.id = node.id
      group.append(hitArea, dot, label, title)
      group.addEventListener('pointerenter', () => { hoveredId = node.id; applyFocusState() })
      group.addEventListener('pointerleave', () => { hoveredId = undefined; applyFocusState() })
      group.addEventListener('pointerdown', event => beginNodeDrag(event, node))
      group.addEventListener('click', event => {
        event.stopPropagation()
        if (node.suppressClick) { node.suppressClick = false; return }
        selectNode(node)
      })
      group.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        selectNode(node)
      })

      node.element = group
      nodeLayer.append(group)
    })

    world.append(edgeLayer, nodeLayer)
    svg.append(world)
    applyTransform()
    updatePositions()
    applyFocusState()
  }

  function updatePositions () {
    edges.forEach(edge => {
      edge.element.setAttribute('x1', edge.source.x)
      edge.element.setAttribute('y1', edge.source.y)
      edge.element.setAttribute('x2', edge.target.x)
      edge.element.setAttribute('y2', edge.target.y)
    })
    nodes.forEach(node => node.element.setAttribute('transform', `translate(${node.x} ${node.y})`))
  }

  function runSimulation (ticks = 240) {
    simulationTicks = Math.max(simulationTicks, ticks)
    if (!simulationFrame) simulationFrame = requestAnimationFrame(simulate)
  }

  function simulate () {
    simulationFrame = undefined
    if (simulationTicks-- <= 0 || !nodes.length) return

    const centerX = Math.max(stage.clientWidth, 680) / 2
    const centerY = Math.max(stage.clientHeight, 560) / 2

    for (let left = 0; left < nodes.length; left++) {
      const a = nodes[left]
      if (a.fixed) continue

      for (let right = left + 1; right < nodes.length; right++) {
        const b = nodes[right]
        let dx = a.x - b.x
        let dy = a.y - b.y
        let distanceSquared = dx * dx + dy * dy

        if (distanceSquared < 4) {
          dx = hash(`${a.id}:${b.id}`) - 0.5
          dy = hash(`${b.id}:${a.id}`) - 0.5
          distanceSquared = dx * dx + dy * dy
        }

        const distance = Math.sqrt(distanceSquared)
        const charge = (a.type === 'category' || b.type === 'category') ? 3100 : 1750
        const force = Math.min(3.2, charge / Math.max(distanceSquared, 90))
        const forceX = (dx / distance) * force
        const forceY = (dy / distance) * force

        if (!a.fixed) { a.vx += forceX; a.vy += forceY }
        if (!b.fixed) { b.vx -= forceX; b.vy -= forceY }
      }
    }

    edges.forEach(edge => {
      const dx = edge.target.x - edge.source.x
      const dy = edge.target.y - edge.source.y
      const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy))
      const ideal = edge.target.type === 'tag' && edge.target.count > 15 ? 158 : 132
      const force = (distance - ideal) * 0.0058
      const forceX = (dx / distance) * force
      const forceY = (dy / distance) * force

      if (!edge.source.fixed) { edge.source.vx += forceX; edge.source.vy += forceY }
      if (!edge.target.fixed) { edge.target.vx -= forceX; edge.target.vy -= forceY }
    })

    nodes.forEach(node => {
      if (node.fixed) return
      const centerStrength = node.type === 'category' ? 0.00065 : 0.00115
      node.vx += (centerX - node.x) * centerStrength
      node.vy += (centerY - node.y) * centerStrength
      node.vx *= 0.86
      node.vy *= 0.86
      node.x += node.vx
      node.y += node.vy
    })

    updatePositions()
    simulationFrame = requestAnimationFrame(simulate)
  }

  function applyTransform () {
    if (world) world.setAttribute('transform', `translate(${transform.x} ${transform.y}) scale(${transform.scale})`)
  }

  function zoom (multiplier, clientX = stage.clientWidth / 2, clientY = stage.clientHeight / 2) {
    const nextScale = Math.max(0.28, Math.min(2.8, transform.scale * multiplier))
    const ratio = nextScale / transform.scale
    transform.x = clientX - (clientX - transform.x) * ratio
    transform.y = clientY - (clientY - transform.y) * ratio
    transform.scale = nextScale
    hasInteracted = true
    applyTransform()
  }

  function fitView () {
    if (!nodes.length) return
    const xs = nodes.map(node => node.x)
    const ys = nodes.map(node => node.y)
    const bounds = {
      minX: Math.min(...xs) - 95,
      maxX: Math.max(...xs) + 150,
      minY: Math.min(...ys) - 75,
      maxY: Math.max(...ys) + 75
    }
    const width = bounds.maxX - bounds.minX
    const height = bounds.maxY - bounds.minY
    const scale = Math.max(0.32, Math.min(1.15, (stage.clientWidth - 54) / width, (stage.clientHeight - 58) / height))
    transform = {
      scale,
      x: (stage.clientWidth - (bounds.minX + bounds.maxX) * scale) / 2,
      y: (stage.clientHeight - (bounds.minY + bounds.maxY) * scale) / 2
    }
    applyTransform()
  }

  function focusNode (node) {
    const nextScale = Math.max(transform.scale, 1.05)
    transform = {
      scale: nextScale,
      x: stage.clientWidth / 2 - node.x * nextScale,
      y: stage.clientHeight / 2 - node.y * nextScale
    }
    applyTransform()
  }

  function rearrange () {
    layoutSeed++
    hasInteracted = false
    selectedId = undefined
    closePanel()
    buildGraph()
    createGraphElements()
    runSimulation(320)
    window.setTimeout(() => { if (!hasInteracted) fitView() }, 700)
  }

  function beginNodeDrag (event, node) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const point = toGraphPoint(event)
    node.fixed = true
    node.vx = 0
    node.vy = 0
    nodeDrag = { node, startX: event.clientX, startY: event.clientY, offsetX: node.x - point.x, offsetY: node.y - point.y, moved: false, pointerId: event.pointerId }
    node.element.setPointerCapture(event.pointerId)
    node.element.classList.add('is-dragging')
  }

  function moveNode (event) {
    if (!nodeDrag || event.pointerId !== nodeDrag.pointerId) return
    const point = toGraphPoint(event)
    nodeDrag.node.x = point.x + nodeDrag.offsetX
    nodeDrag.node.y = point.y + nodeDrag.offsetY
    nodeDrag.moved ||= Math.hypot(event.clientX - nodeDrag.startX, event.clientY - nodeDrag.startY) > 4
    hasInteracted = true
    updatePositions()
  }

  function endNodeDrag (event) {
    if (!nodeDrag || event.pointerId !== nodeDrag.pointerId) return
    const { node, moved } = nodeDrag
    node.fixed = false
    node.suppressClick = moved
    node.element.classList.remove('is-dragging')
    nodeDrag = undefined
    runSimulation(90)
  }

  function toGraphPoint (event) {
    const rect = stage.getBoundingClientRect()
    return {
      x: (event.clientX - rect.left - transform.x) / transform.scale,
      y: (event.clientY - rect.top - transform.y) / transform.scale
    }
  }

  function selectNode (node) {
    const isClosing = selectedId === node.id
    selectedId = isClosing ? undefined : node.id
    applyFocusState()
    if (node.type === 'tag') {
      if (isClosing) closePanel()
      else openTag(node.name)
    }
  }

  function applyFocusState () {
    const focusId = hoveredId || selectedId
    let visibleIds

    if (focusId) {
      visibleIds = new Set([focusId, ...(neighbours.get(focusId) || [])])
    } else if (search.value.trim()) {
      visibleIds = searchMatches
    }

    nodes.forEach(node => {
      const isFocus = node.id === focusId || searchMatches.has(node.id)
      const isRelated = focusId && neighbours.get(focusId)?.has(node.id)
      node.element.classList.toggle('is-focus', Boolean(isFocus))
      node.element.classList.toggle('is-related', Boolean(isRelated))
      node.element.classList.toggle('is-muted', Boolean(visibleIds && !visibleIds.has(node.id)))
    })

    edges.forEach(edge => {
      const active = focusId && (edge.source.id === focusId || edge.target.id === focusId)
      const searchActive = !focusId && searchMatches.has(edge.source.id) && searchMatches.has(edge.target.id)
      edge.element.classList.toggle('is-active', Boolean(active || searchActive))
      edge.element.classList.toggle('is-muted', Boolean(visibleIds && !active && !searchActive))
    })
  }

  function applySearch () {
    const query = normalize(search.value)
    searchMatches = new Set()

    if (query) {
      nodes.forEach(node => {
        if (normalize(node.name).includes(query)) searchMatches.add(node.id)
      })

      data.posts.forEach(post => {
        if (!normalize(post.title).includes(query)) return
        post.tags.forEach(tagName => {
          const id = `tag:${tagName}`
          if (nodeById.has(id)) searchMatches.add(id)
        })
      })
    }

    applyFocusState()
  }

  function openTag (tagName) {
    const posts = (data.tags[tagName] || []).map(index => data.posts[index]).filter(Boolean)
    const shownPosts = posts.slice(0, 12)
    panel.classList.add('is-open')
    panel.innerHTML = `
      <header class="detail-head">
        <div class="detail-title-row">
          <div><span class="detail-kind">标签</span><h2># ${escapeHtml(tagName)}</h2></div>
          <button class="close-detail" type="button" aria-label="关闭详情" title="关闭详情">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"></path></svg>
          </button>
        </div>
        <div class="detail-meta"><i></i><span>${posts.length} 篇文章${posts.length > shownPosts.length ? ` · 图中显示 ${shownPosts.length} 篇` : ''}</span></div>
      </header>
      <div class="mini-graph"><svg viewBox="0 0 380 280" aria-label="${escapeHtml(tagName)} 与文章的局部图谱"></svg></div>
      <section class="article-section">
        <h3>相关文章</h3>
        <ul class="article-list">${posts.map(post => `<li><a href="${post.url}"><span class="article-icon"><i></i></span><span class="article-title">${escapeHtml(post.title)}</span><time class="article-date">${post.date}</time></a></li>`).join('')}</ul>
      </section>`
    panel.querySelector('.close-detail').addEventListener('click', closePanel)
    drawMiniGraph(panel.querySelector('.mini-graph svg'), tagName, shownPosts)
  }

  function drawMiniGraph (target, tagName, posts) {
    const center = { x: 190, y: 140 }
    const radiusX = 100
    const radiusY = 104

    posts.forEach((post, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(posts.length, 1) - Math.PI / 2
      const point = { x: center.x + Math.cos(angle) * radiusX, y: center.y + Math.sin(angle) * radiusY }
      const line = createSvg('line', { class: 'mini-edge', x1: center.x, y1: center.y, x2: point.x, y2: point.y })
      const link = createSvg('a', { href: post.url, 'aria-label': post.title })
      const dot = createSvg('circle', { class: 'mini-post', cx: point.x, cy: point.y, r: 5.5 })
      const label = createSvg('text', {
        class: 'mini-label',
        x: point.x + (Math.cos(angle) >= 0 ? 10 : -10),
        y: point.y + 4,
        'text-anchor': Math.cos(angle) >= 0 ? 'start' : 'end'
      })
      label.textContent = post.title.length > 13 ? `${post.title.slice(0, 13)}…` : post.title
      link.append(dot, label)
      target.append(line, link)
    })

    target.append(createSvg('circle', { class: 'mini-center-ring', cx: center.x, cy: center.y, r: 18 }))
    target.append(createSvg('circle', { class: 'mini-center', cx: center.x, cy: center.y, r: 8 }))
    const centerLabel = createSvg('text', { class: 'mini-center-label', x: center.x, y: center.y + 34, 'text-anchor': 'middle' })
    centerLabel.textContent = `# ${tagName.length > 13 ? `${tagName.slice(0, 13)}…` : tagName}`
    target.append(centerLabel)
  }

  function closePanel () {
    panel.classList.remove('is-open')
    panel.innerHTML = '<div class="empty-detail"><div class="empty-graph" aria-hidden="true"><i></i><i></i><i></i><i></i></div><h2>选择一个标签</h2><p>点击任意标签，在这里展开它与相关文章的局部图谱。</p></div>'
  }

  function escapeHtml (value) {
    return String(value).replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character]))
  }

  stage.addEventListener('wheel', event => {
    event.preventDefault()
    const rect = stage.getBoundingClientRect()
    zoom(event.deltaY < 0 ? 1.12 : 0.89, event.clientX - rect.left, event.clientY - rect.top)
  }, { passive: false })

  stage.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('.node') || event.target.closest('button')) return
    canvasDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: transform.x, startY: transform.y }
    stage.setPointerCapture(event.pointerId)
    stage.classList.add('is-dragging')
  })

  stage.addEventListener('pointermove', event => {
    moveNode(event)
    if (!canvasDrag || event.pointerId !== canvasDrag.pointerId) return
    transform.x = canvasDrag.startX + event.clientX - canvasDrag.x
    transform.y = canvasDrag.startY + event.clientY - canvasDrag.y
    hasInteracted = true
    applyTransform()
  })

  stage.addEventListener('pointerup', event => {
    endNodeDrag(event)
    if (!canvasDrag || event.pointerId !== canvasDrag.pointerId) return
    canvasDrag = undefined
    stage.classList.remove('is-dragging')
  })

  stage.addEventListener('pointercancel', event => {
    endNodeDrag(event)
    canvasDrag = undefined
    stage.classList.remove('is-dragging')
  })

  search.addEventListener('input', applySearch)
  search.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return
    const query = normalize(search.value)
    const match = nodes.find(node => searchMatches.has(node.id) && node.type === 'tag' && normalize(node.name) === query) ||
      nodes.find(node => searchMatches.has(node.id) && normalize(node.name) === query) ||
      nodes.find(node => searchMatches.has(node.id) && node.type === 'tag') ||
      nodes.find(node => searchMatches.has(node.id))
    if (!match) return
    selectedId = match.id
    focusNode(match)
    applyFocusState()
    if (match.type === 'tag') openTag(match.name)
  })

  document.addEventListener('keydown', event => {
    if (event.key === '/' && document.activeElement !== search) {
      event.preventDefault()
      search.focus()
    }
    if (event.key === 'Escape') {
      selectedId = undefined
      hoveredId = undefined
      search.value = ''
      applySearch()
      closePanel()
    }
  })

  document.querySelector('#zoom-in').addEventListener('click', () => zoom(1.2))
  document.querySelector('#zoom-out').addEventListener('click', () => zoom(0.82))
  document.querySelector('#fit-view').addEventListener('click', () => { hasInteracted = true; fitView() })
  document.querySelector('#reset-view').addEventListener('click', rearrange)
  window.addEventListener('resize', () => { if (data) fitView() })

  fetch('/graph/data.json')
    .then(response => {
      if (!response.ok) throw new Error('图谱数据加载失败')
      return response.json()
    })
    .then(payload => {
      data = payload
      buildGraph()
      createGraphElements()
      summary.textContent = `${data.categories.length} 个分类 · ${nodes.filter(node => node.type === 'tag').length} 个标签`
      status.remove()
      runSimulation(320)
      window.setTimeout(() => { if (!hasInteracted) fitView() }, 700)
    })
    .catch(error => { status.textContent = error.message })
})()
