(function () {
  'use strict'

  const TAU = Math.PI * 2

  function initGraph (root) {
    if (root.dataset.graphReady === 'true') return
    root.dataset.graphReady = 'true'

    const canvas = root.querySelector('.knowledge-graph__canvas')
    const dataEl = root.querySelector('.knowledge-graph__data')
    const tooltip = root.querySelector('.knowledge-graph__tooltip')
    if (!canvas || !dataEl) return

    const graph = JSON.parse(dataEl.textContent || '{"nodes":[],"links":[]}')
    const ctx = canvas.getContext('2d')
    const nodes = graph.nodes.map((node, index) => ({
      ...node,
      x: Math.cos(index * 2.399) * 180,
      y: Math.sin(index * 2.399) * 180,
      vx: 0,
      vy: 0,
      fixed: false,
      pinX: null,
      pinY: null,
      pinStrength: 0
    }))
    const nodeMap = new Map(nodes.map(node => [node.id, node]))
    const links = graph.links
      .map(link => ({ ...link, sourceNode: nodeMap.get(link.source), targetNode: nodeMap.get(link.target) }))
      .filter(link => link.sourceNode && link.targetNode)
    const linkedPairs = new Set(links.map(link => pairKey(link.sourceNode, link.targetNode)))

    let width = 0
    let height = 0
    let dpr = 1
    let hovered = null
    let dragged = null
    let dragStart = null
    let dragTarget = null
    let moved = false
    let animationId = 0

    function resize () {
      const rect = canvas.parentElement.getBoundingClientRect()
      dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
      width = Math.max(320, rect.width)
      height = Math.max(320, rect.height)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = width + 'px'
      canvas.style.height = height + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, width * dpr / 2, height * dpr / 2)
    }

    function radius (node) {
      if (node.type === 'category') return 9
      return 3.5 + Math.min(2.5, node.categories.length * 0.8)
    }

    function hitRadius (node) {
      return radius(node) + 3
    }

    function pairKey (a, b) {
      return a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`
    }

    function color (node) {
      if (node.type === 'category') return '#e963a3'
      const palette = ['#2f88ff', '#22a06b', '#f59f00', '#7c5cff', '#00a7b5', '#f06449']
      const source = node.categories[0] || node.title
      let hash = 0
      for (let i = 0; i < source.length; i++) hash = (hash * 31 + source.charCodeAt(i)) >>> 0
      return palette[hash % palette.length]
    }

    function step () {
      const centerPull = 0.004
      const graphCenterPull = 0.012
      const repel = 1900
      const centroid = nodes.reduce((memo, node) => {
        memo.x += node.x
        memo.y += node.y
        return memo
      }, { x: 0, y: 0 })
      centroid.x /= Math.max(1, nodes.length)
      centroid.y /= Math.max(1, nodes.length)

      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i]
        if (!a.fixed) {
          a.vx += -centroid.x * graphCenterPull
          a.vy += -centroid.y * graphCenterPull
          a.vx += -a.x * centerPull
          a.vy += -a.y * centerPull
        }

        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j]
          if (linkedPairs.has(pairKey(a, b))) continue

          let dx = a.x - b.x
          let dy = a.y - b.y
          let dist2 = dx * dx + dy * dy
          if (dist2 < 1) {
            dx = Math.random() - 0.5
            dy = Math.random() - 0.5
            dist2 = dx * dx + dy * dy
          }
          const dist = Math.sqrt(dist2)
          const force = repel / Math.max(80, dist2)
          const fx = dx / dist * force
          const fy = dy / dist * force
          if (!a.fixed) {
            a.vx += fx
            a.vy += fy
          }
          if (!b.fixed) {
            b.vx -= fx
            b.vy -= fy
          }
        }
      }

      links.forEach(link => {
        const a = link.sourceNode
        const b = link.targetNode
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy))
        const ideal = link.type === 'category' ? 105 : 78
        const nx = dx / dist
        const ny = dy / dist
        const springForce = (dist - ideal) * 0.003 * (link.strength || 1)
        const relativeVelocity = ((b.vx - a.vx) * nx) + ((b.vy - a.vy) * ny)
        const dampingForce = relativeVelocity * 0.09
        const force = springForce + dampingForce
        const fx = nx * force
        const fy = ny * force
        if (!a.fixed) {
          a.vx += fx
          a.vy += fy
        }
        if (!b.fixed) {
          b.vx -= fx
          b.vy -= fy
        }
      })

      nodes.forEach(node => {
        if (!node.pinStrength || node.pinX === null || node.pinY === null) return
        node.vx += ((node.pinX - node.x) * node.pinStrength) - (node.vx * 0.08)
        node.vy += ((node.pinY - node.y) * node.pinStrength) - (node.vy * 0.08)
      })

      if (dragged && dragStart && dragTarget) {
        dragged.vx += (dragTarget.x - dragged.x) * 0.34
        dragged.vy += (dragTarget.y - dragged.y) * 0.34
      }

      nodes.forEach(node => {
        if (node.fixed) return
        node.vx *= 0.86
        node.vy *= 0.86
        node.vx = clamp(node.vx, -18, 18)
        node.vy = clamp(node.vy, -18, 18)
        node.x += node.vx
        node.y += node.vy
        keepInBounds(node)
      })
    }

    function clamp (value, min, max) {
      return Math.max(min, Math.min(max, value))
    }

    function keepInBounds (node) {
      const padding = Math.max(8, radius(node) + 4)
      const minX = -width / 2 + padding
      const maxX = width / 2 - padding
      const minY = -height / 2 + padding
      const maxY = height / 2 - padding

      if (node.x < minX) {
        node.x = minX
        node.vx = Math.abs(node.vx) * 0.2
      } else if (node.x > maxX) {
        node.x = maxX
        node.vx = -Math.abs(node.vx) * 0.2
      }

      if (node.y < minY) {
        node.y = minY
        node.vy = Math.abs(node.vy) * 0.2
      } else if (node.y > maxY) {
        node.y = maxY
        node.vy = -Math.abs(node.vy) * 0.2
      }
    }

    function boundPointForNode (point, node) {
      const padding = Math.max(8, radius(node) + 4)
      return {
        x: clamp(point.x, -width / 2 + padding, width / 2 - padding),
        y: clamp(point.y, -height / 2 + padding, height / 2 - padding)
      }
    }

    function draw () {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.setTransform(dpr, 0, 0, dpr, width * dpr / 2, height * dpr / 2)

      links.forEach(link => {
        ctx.beginPath()
        ctx.moveTo(link.sourceNode.x, link.sourceNode.y)
        ctx.lineTo(link.targetNode.x, link.targetNode.y)
        ctx.lineWidth = link.type === 'wiki' ? 1.8 : 1.2
        ctx.strokeStyle = link.type === 'wiki' ? 'rgba(233, 99, 163, .5)' : 'rgba(80, 110, 150, .28)'
        ctx.stroke()
      })

      nodes.forEach(node => {
        const r = radius(node)
        const isActive = node === hovered || node === dragged
        ctx.beginPath()
        ctx.arc(node.x, node.y, r + (isActive ? 4 : 0), 0, TAU)
        ctx.fillStyle = isActive ? 'rgba(233, 99, 163, .18)' : 'rgba(255, 255, 255, .72)'
        ctx.fill()

        ctx.beginPath()
        ctx.arc(node.x, node.y, r, 0, TAU)
        ctx.fillStyle = color(node)
        ctx.fill()

        ctx.lineWidth = node.type === 'category' ? 2 : 1.4
        ctx.strokeStyle = 'rgba(255, 255, 255, .9)'
        ctx.stroke()

        if (node.type === 'category' || isActive) {
          ctx.font = node.type === 'category' ? '600 11px system-ui, sans-serif' : '10px system-ui, sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'
          ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--font-color') || '#333'
          ctx.fillText(node.title, node.x, node.y + r + 6, 180)
        }
      })
    }

    function tick () {
      step()
      draw()
      animationId = requestAnimationFrame(tick)
    }

    function pointerPosition (event) {
      const rect = canvas.getBoundingClientRect()
      return {
        x: event.clientX - rect.left - width / 2,
        y: event.clientY - rect.top - height / 2,
        pageX: event.clientX - rect.left,
        pageY: event.clientY - rect.top
      }
    }

    function findNode (pos) {
      let best = null
      let bestDistance = Infinity
      for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i]
        const dx = node.x - pos.x
        const dy = node.y - pos.y
        const distance = Math.sqrt(dx * dx + dy * dy)
        if (distance <= hitRadius(node) && distance < bestDistance) {
          best = node
          bestDistance = distance
        }
      }
      return best
    }

    canvas.addEventListener('pointerdown', event => {
      const pos = pointerPosition(event)
      dragged = findNode(pos)
      moved = false
      if (dragged) {
        dragStart = {
          x: pos.x,
          y: pos.y
        }
        dragTarget = boundPointForNode(pos, dragged)
        dragged.pinX = null
        dragged.pinY = null
        dragged.pinStrength = 0
        hovered = dragged
        canvas.setPointerCapture(event.pointerId)
        canvas.classList.add('is-dragging')
      }
    })

    canvas.addEventListener('pointermove', event => {
      const pos = pointerPosition(event)
      if (dragged) {
        const dx = pos.x - dragStart.x
        const dy = pos.y - dragStart.y
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true

        dragTarget = boundPointForNode(pos, dragged)
        return
      }

      hovered = findNode(pos)
      if (hovered) {
        tooltip.hidden = false
        tooltip.style.left = pos.pageX + 'px'
        tooltip.style.top = pos.pageY + 'px'
        tooltip.textContent = hovered.type === 'category'
          ? hovered.title
          : `${hovered.title}${hovered.categories.length ? ' / ' + hovered.categories.join(', ') : ''}`
      } else {
        tooltip.hidden = true
      }
    })

    function finishDrag (event, shouldOpen) {
      if (dragged && shouldOpen && !moved && dragged.path) window.location.href = dragged.path
      if (dragged) {
        dragged.pinX = dragged.x
        dragged.pinY = dragged.y
        dragged.pinStrength = 0.026
        dragged.vx *= 0.15
        dragged.vy *= 0.15
        keepInBounds(dragged)
      }
      dragged = null
      dragStart = null
      dragTarget = null
      canvas.classList.remove('is-dragging')
      if (event && event.pointerId !== undefined) {
        try { canvas.releasePointerCapture(event.pointerId) } catch (e) {}
      }
    }

    canvas.addEventListener('pointerup', event => {
      finishDrag(event, true)
    })

    canvas.addEventListener('pointercancel', event => {
      finishDrag(event, false)
    })

    canvas.addEventListener('lostpointercapture', event => {
      finishDrag(event, false)
    })

    canvas.addEventListener('pointerleave', () => {
      hovered = null
      tooltip.hidden = true
    })

    window.addEventListener('resize', resize)
    resize()
    tick()

    root.cleanupKnowledgeGraph = function () {
      cancelAnimationFrame(animationId)
      window.removeEventListener('resize', resize)
    }
  }

  function initAll () {
    document.querySelectorAll('#knowledge-graph').forEach(initGraph)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll)
  } else {
    initAll()
  }

  document.addEventListener('pjax:complete', initAll)
})()
