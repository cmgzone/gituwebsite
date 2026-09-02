import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

type Particle = {
  x: number
  y: number
  z: number
  phase: number
  size: number
  color: THREE.Color
}

const LETTERS = [
  ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  ['01110', '10001', '10000', '10111', '10001', '10001', '01110'],
  ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  ['01110', '10001', '10000', '10111', '10001', '10001', '01110'],
  ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
]

const PARTICLES_PER_CELL = 24
const COLOR_STOPS = [
  new THREE.Color('#3d7cff'),
  new THREE.Color('#22d9ef'),
  new THREE.Color('#54ef8d'),
]

function colorFor(normalizedX: number) {
  const scaled = THREE.MathUtils.clamp(normalizedX, 0, 1) * (COLOR_STOPS.length - 1)
  const start = Math.floor(scaled)
  const end = Math.min(start + 1, COLOR_STOPS.length - 1)
  return COLOR_STOPS[start].clone().lerp(COLOR_STOPS[end], scaled - start)
}

function createParticles() {
  const particles: Particle[] = []
  const letterWidth = 5
  const letterGap = 1.5
  const totalWidth = LETTERS.length * letterWidth + (LETTERS.length - 1) * letterGap + letterGap

  LETTERS.forEach((letter, letterIndex) => {
    letter.forEach((row, rowIndex) => {
      Array.from(row).forEach((cell, cellIndex) => {
        if (cell !== '1') return
        const cellX = letterIndex * (letterWidth + letterGap) + cellIndex + (letterIndex >= 5 ? letterGap : 0)
        const x = (cellX - (totalWidth - 1) / 2) * 0.105
        const y = ((LETTERS[0].length - 1) / 2 - rowIndex) * 0.48

        for (let index = 0; index < PARTICLES_PER_CELL; index += 1) {
          const angle = (index / PARTICLES_PER_CELL) * Math.PI * 2
          const radius = 0.045 + (index % 3) * 0.019
          particles.push({
            x: x + Math.cos(angle) * radius,
            y: y + Math.sin(angle) * radius,
            z: (index % 5) * 0.035 - 0.07,
            phase: index * 0.71 + cellX * 0.32 + rowIndex * 0.18,
            size: 0.72 + (index % 4) * 0.14,
            color: colorFor(cellX / (totalWidth - 1)),
          })
        }
      })
    })
  })

  return particles
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const material = mesh.material
    if (Array.isArray(material)) material.forEach((item) => item.dispose())
    else if (material) material.dispose()
  })
}

export default function ParticleWordmark() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [fallback, setFallback] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'low-power',
      })
      renderer.domElement.setAttribute('aria-label', 'AGENT GITU particle wordmark')
      renderer.domElement.setAttribute('data-renderer', 'three')
      renderer.domElement.setAttribute('data-renderer-contract', 'direct-three')
    } catch {
      setFallback(true)
      return undefined
    }

    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-5, 5, 3, -3, 0.1, 20)
    camera.position.z = 8

    const particles = createParticles()
    const positions = new Float32Array(particles.length * 3)
    const colors = new Float32Array(particles.length * 3)
    const sizes = new Float32Array(particles.length)

    particles.forEach((particle, index) => {
      const positionIndex = index * 3
      positions[positionIndex] = particle.x
      positions[positionIndex + 1] = particle.y
      positions[positionIndex + 2] = particle.z
      colors[positionIndex] = particle.color.r
      colors[positionIndex + 1] = particle.color.g
      colors[positionIndex + 2] = particle.color.b
      sizes[index] = particle.size
    })

    const pointsGeometry = new THREE.BufferGeometry()
    pointsGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    pointsGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    pointsGeometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))

    const pointsMaterial = new THREE.PointsMaterial({
      size: 4.8,
      vertexColors: true,
      transparent: true,
      opacity: 0.94,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const points = new THREE.Points(pointsGeometry, pointsMaterial)
    scene.add(points)

    const connectionPositions: number[] = []
    const connectionPairs: Array<[number, number]> = []
    for (let index = 0; index < particles.length; index += PARTICLES_PER_CELL) {
      const source = particles[index]
      for (let offset = 1; offset < 5 && index + offset < particles.length; offset += 1) {
        const targetIndex = index + offset
        const target = particles[targetIndex]
        connectionPairs.push([index, targetIndex])
        connectionPositions.push(source.x, source.y, source.z, target.x, target.y, target.z)
      }
    }
    const connectionGeometry = new THREE.BufferGeometry()
    connectionGeometry.setAttribute('position', new THREE.Float32BufferAttribute(connectionPositions, 3))
    const connectionMaterial = new THREE.LineBasicMaterial({
      color: '#35cce0',
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const connections = new THREE.LineSegments(connectionGeometry, connectionMaterial)
    scene.add(connections)

    const pointer = new THREE.Vector2(0, 0)
    const targetPointer = new THREE.Vector2(0, 0)
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const clock = new THREE.Clock()
    let frame = 0
    let visible = true
    let scatterTarget = 0
    let scatterAmount = 0
    let scatterTimeout: number | undefined

    const triggerScatter = () => {
      scatterTarget = 1
      if (scatterTimeout !== undefined) window.clearTimeout(scatterTimeout)
      scatterTimeout = window.setTimeout(() => {
        scatterTarget = 0
      }, 840)
    }

    const onPointerDown = () => {
      triggerScatter()
    }

    const onPointerLeave = () => {
      targetPointer.set(0, 0)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      triggerScatter()
    }

    const resize = () => {
      const width = Math.max(container.clientWidth, 1)
      const height = Math.max(container.clientHeight, 1)
      const aspect = width / height
      const viewHeight = 6.2
      camera.top = viewHeight / 2
      camera.bottom = -viewHeight / 2
      camera.right = (viewHeight * aspect) / 2
      camera.left = -(viewHeight * aspect) / 2
      camera.updateProjectionMatrix()
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
      renderer.setSize(width, height, false)
    }

    const onPointerMove = (event: PointerEvent) => {
      const bounds = container.getBoundingClientRect()
      targetPointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
      targetPointer.y = -(((event.clientY - bounds.top) / bounds.height) * 2 - 1)
    }

    const observer = new ResizeObserver(resize)
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
    })

    container.appendChild(renderer.domElement)
    renderer.domElement.setAttribute('aria-hidden', 'true')
    renderer.domElement.className = 'particle-wordmark__canvas'
    observer.observe(container)
    visibilityObserver.observe(container)
    container.addEventListener('pointermove', onPointerMove)
    container.addEventListener('pointerdown', onPointerDown)
    container.addEventListener('pointerleave', onPointerLeave)
    container.addEventListener('keydown', onKeyDown)
    resize()

    const animate = () => {
      frame = window.requestAnimationFrame(animate)
      if (!visible) return

      const elapsed = clock.getElapsedTime()
      const motion = reducedMotion.matches ? 0.15 : 1
      const scatterResponse = reducedMotion.matches ? 0.18 : 0.085
      scatterAmount += (scatterTarget - scatterAmount) * scatterResponse
      pointer.lerp(targetPointer, 0.055)
      const pointAttribute = pointsGeometry.getAttribute('position') as THREE.BufferAttribute
      const lineAttribute = connectionGeometry.getAttribute('position') as THREE.BufferAttribute

      particles.forEach((particle, index) => {
        const distance = Math.hypot(pointer.x - particle.x / 4.2, pointer.y - particle.y / 2.5)
        const influence = THREE.MathUtils.clamp(1 - distance * 2.2, 0, 1)
        const scatterAngle = particle.phase * 1.9 + index * 0.17
        const scatterRadius = 0.55 + (index % 5) * 0.08
        const scatterX = Math.cos(scatterAngle) * scatterRadius
        const scatterY = Math.sin(scatterAngle) * scatterRadius * 0.72
        const scatterZ = 0.18 + (index % 4) * 0.06
        const wave = Math.sin(elapsed * 1.1 * motion + particle.phase) * 0.012 * motion
        pointAttribute.setXYZ(
          index,
          particle.x + scatterX * scatterAmount + pointer.x * influence * 0.11,
          particle.y + scatterY * scatterAmount + pointer.y * influence * 0.11 + wave,
          particle.z + scatterZ * scatterAmount + influence * 0.22 + Math.sin(elapsed * 0.8 * motion + particle.phase) * 0.035 * motion,
        )
      })

      let lineIndex = 0
      connectionPairs.forEach(([sourceParticleIndex, targetParticleIndex]) => {
        lineAttribute.setXYZ(
          lineIndex,
          pointAttribute.getX(sourceParticleIndex),
          pointAttribute.getY(sourceParticleIndex),
          pointAttribute.getZ(sourceParticleIndex),
        )
        lineIndex += 1
        lineAttribute.setXYZ(
          lineIndex,
          pointAttribute.getX(targetParticleIndex),
          pointAttribute.getY(targetParticleIndex),
          pointAttribute.getZ(targetParticleIndex),
        )
        lineIndex += 1
      })
      pointAttribute.needsUpdate = true
      lineAttribute.needsUpdate = true
      points.rotation.z = Math.sin(elapsed * 0.18 * motion) * 0.012
      connections.rotation.z = points.rotation.z
      renderer.render(scene, camera)
    }

    animate()

    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      visibilityObserver.disconnect()
      container.removeEventListener('pointermove', onPointerMove)
      container.removeEventListener('pointerdown', onPointerDown)
      container.removeEventListener('pointerleave', onPointerLeave)
      container.removeEventListener('keydown', onKeyDown)
      if (scatterTimeout !== undefined) window.clearTimeout(scatterTimeout)
      disposeObject(scene)
      renderer.dispose()
      if (renderer.domElement.parentElement === container) container.removeChild(renderer.domElement)
    }
  }, [])

  return (
    <div
      className={`particle-wordmark${fallback ? ' particle-wordmark--fallback' : ''}`}
      ref={containerRef}
      role="button"
      tabIndex={0}
      aria-label="Interactive AGENT GITU particle wordmark. Press to scatter and reform the particles."
    >
      {fallback && (
        <div className="particle-wordmark__fallback" aria-label="AGENT GITU particle wordmark fallback">
          <span>AGENT GITU</span>
          <small>WebGL fallback / AGENT GITU signal stable</small>
        </div>
      )}
    </div>
  )
}
