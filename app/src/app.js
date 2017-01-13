import Tooltip from './tooltip.js'
import Cluster from './cluster.js'
import {Pod, ALL_PODS, sortByName, sortByMemory, sortByCPU, sortByAge} from './pod.js'
import SelectBox from './selectbox'
import { Theme, ALL_THEMES} from './themes.js'
import { DESATURATION_FILTER } from './filters.js'
import { JSON_delta } from './vendor/json_delta.js'

const PIXI = require('pixi.js')


export default class App {

    constructor() {
        const params = this.parseLocationHash()
        this.filterString = params.get('q') || ''
        this.selectedClusters = new Set((params.get('clusters') || '').split(',').filter(x => x))
        this.seenPods = new Set()
        this.sorterFn = ''
        this.theme = Theme.get(localStorage.getItem('theme'))
        this.eventSource = null
        this.keepAliveTimer = null
        this.keepAliveSeconds = 20
        this.clusters = new Map()
    }

    parseLocationHash() {
        // hash startswith #
        const hash = document.location.hash.substring(1)
        const params = new Map()
        for (const pair of hash.split(';')) {
            const keyValue = pair.split('=', 2)
            if (keyValue.length == 2) {
                params.set(keyValue[0], keyValue[1])
            }
        }
        return params
    }

    changeLocationHash(key, value) {
        const params = this.parseLocationHash()
        params.set(key, value)
        const pairs = []
        for (const [key, value] of params) {
            if (value) {
                pairs.push(key + '=' + value)
            }
        }

        document.location.hash = '#' + pairs.sort().join(';')
    }

    filter() {
        const searchString = this.filterString
        this.searchText.text = searchString
        this.changeLocationHash('q', searchString)
        const filter = DESATURATION_FILTER
        for (const cluster of this.viewContainer.children) {
            for (const node of cluster.children) {
                const name = node.pod && node.pod.name
                if (name) {
                    // node is actually unassigned pod
                    if (!name.includes(searchString)){
                        node.filters = [filter]
                    } else {
                        // TODO: pod might have other filters set..
                        node.filters = []
                    }
                }
                for (const pod of node.children) {
                    const name = pod.pod && pod.pod.name
                    if (name) {
                        if (!name.includes(searchString)) {
                            pod.filters = [filter]
                        } else {
                            // TODO: pod might have other filters set..
                            pod.filters = []
                        }
                    }
                }
            }
        }
    }

    initialize() {
        App.current = this

        //Create the renderer
        const renderer = PIXI.autoDetectRenderer(256, 256, {resolution: 2})
        renderer.view.style.display = 'block'
        renderer.autoResize = true
        renderer.resize(window.innerWidth, window.innerHeight)

        window.onresize = function() {
            renderer.resize(window.innerWidth, window.innerHeight)
        }

        //Add the canvas to the HTML document
        document.body.appendChild(renderer.view)
        this.renderer = renderer

        //Create a container object called the `stage`
        this.stage = new PIXI.Container()

        function downHandler(event) {
            if (event.key && event.key.length == 1 && !event.ctrlKey && !event.metaKey) {
                this.filterString += event.key
                this.filter()
                event.preventDefault()
            }
            else if (event.key == 'Backspace') {
                this.filterString = this.filterString.slice(0, Math.max(0, this.filterString.length - 1))
                this.filter()
                event.preventDefault()
            }
        }

        addEventListener(
            'keydown', downHandler.bind(this), false
        )
    }

    draw() {
        this.stage.removeChildren()
        this.theme.apply(this.stage)

        const menuBar = new PIXI.Graphics()
        menuBar.beginFill(this.theme.secondaryColor, 0.8)
        menuBar.drawRect(0, 0, this.renderer.width, 28)
        menuBar.lineStyle(2, this.theme.secondaryColor, 0.8)
        menuBar.moveTo(0, 28)
        menuBar.lineTo(this.renderer.width, 28)
        menuBar.lineStyle(1, this.theme.primaryColor, 1)
        menuBar.drawRect(20, 3, 200, 22)
        this.stage.addChild(menuBar)

        const searchPrompt = new PIXI.Text('>', {fontFamily: 'ShareTechMono', fontSize: 14, fill: this.theme.primaryColor})
        searchPrompt.x = 26
        searchPrompt.y = 8
        PIXI.ticker.shared.add(function (_) {
            var v = Math.sin((PIXI.ticker.shared.lastTime % 2000) / 2000. * Math.PI)
            searchPrompt.alpha = v
        })
        this.stage.addChild(searchPrompt)

        const searchText = new PIXI.Text('', {fontFamily: 'ShareTechMono', fontSize: 14, fill: this.theme.primaryColor})
        searchText.x = 40
        searchText.y = 8
        this.stage.addChild(searchText)

        const items = [
            {
                text: 'SORT: NAME', value: sortByName
            },
            {
                text: 'SORT: AGE', value: sortByAge
            },
            {
                text: 'SORT: MEMORY', value: sortByMemory
            },
            {
                text: 'SORT: CPU', value: sortByCPU
            }
        ]
        //setting default sort
        this.sorterFn = items[0].value
        const app = this
        const selectBox = new SelectBox(items, this.sorterFn, function(value) {
            app.changeSorting(value)
        })
        selectBox.x = 265
        selectBox.y = 3
        menuBar.addChild(selectBox.draw())

        const themeOptions = Object.keys(ALL_THEMES).sort().map(name => { return {text: name.toUpperCase(), value: name}})
        const themeSelector = new SelectBox(themeOptions, this.theme.name, function(value) {
            app.switchTheme(value)
        })
        themeSelector.x = 420
        themeSelector.y = 3
        menuBar.addChild(themeSelector.draw())

        const viewContainer = new PIXI.Container()
        viewContainer.x = 20
        viewContainer.y = 40
        this.stage.addChild(viewContainer)

        const tooltip = new Tooltip()
        tooltip.draw()
        this.stage.addChild(tooltip)

        this.searchText = searchText
        this.viewContainer = viewContainer
        this.tooltip = tooltip
    }

    animatePodCreation(originalPod, globalPosition) {
        const pod = new Pod(originalPod.pod, null, this.tooltip)
        pod.draw()
        pod.blendMode = PIXI.BLEND_MODES.ADD
        pod.interactive = false
        const targetPosition = globalPosition
        const angle = Math.random()*Math.PI*2
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        const distance = Math.max(200, Math.random() * Math.min(this.renderer.width, this.renderer.height))
        // blur filter looks cool, but has huge performance penalty
        // const blur = new PIXI.filters.BlurFilter(20, 2)
        // pod.filters = [blur]
        pod.pivot.x = pod.width / 2
        pod.pivot.y = pod.height / 2
        pod.alpha = 0
        pod._progress = 0
        originalPod.visible = false
        const that = this
        const tick = function (t) {
            // progress goes from 0 to 1
            const progress = Math.min(1, pod._progress + (0.01 * t))
            const scale = 1 + ((1 - progress) * 140)
            pod._progress = progress
            pod.x = targetPosition.x + (distance * cos * (1 - progress))
            pod.y = targetPosition.y + (distance * sin * (1 - progress))
            pod.alpha = progress
            pod.rotation = progress * progress * Math.PI * 2
            // blur.blur = (1 - alpha) * 20
            pod.scale.set(scale)
            if (progress >= 1) {
                PIXI.ticker.shared.remove(tick)
                that.stage.removeChild(pod)
                pod.destroy()
                originalPod.visible = true
            }
        }
        PIXI.ticker.shared.add(tick)
        this.stage.addChild(pod)
    }
    animatePodDeletion(originalPod, globalPosition) {
        const pod = new Pod(originalPod.pod, null, this.tooltip)
        pod.draw()
        pod.blendMode = PIXI.BLEND_MODES.ADD
        const globalCenter = new PIXI.Point(globalPosition.x + pod.width/2, globalPosition.y + pod.height/2)
        const blur = new PIXI.filters.BlurFilter(4)
        pod.filters = [blur]
        pod.position = globalPosition.clone()
        pod.alpha = 1
        pod._progress = 1
        originalPod.destroy()
        const that = this
        const tick = function(t) {
            // progress goes from 1 to 0
            const progress = Math.max(0, pod._progress - (0.02 * t))
            const scale = 1 + ((1 - progress) * 8)
            pod._progress = progress
            pod.alpha = progress
            pod.scale.set(scale)
            pod.position.set(globalCenter.x - pod.width/2, globalCenter.y - pod.height/2)

            if (progress <= 0) {
                PIXI.ticker.shared.remove(tick)
                that.stage.removeChild(pod)
                pod.destroy()
            }
        }
        PIXI.ticker.shared.add(tick)
        this.stage.addChild(pod)
    }
    update() {
        // make sure we create a copy (this.clusters might get modified)
        const clusters = Array.from(this.clusters.entries()).sort().map(idCluster => idCluster[1])
        const that = this
        let changes = 0
        const firstTime = this.seenPods.size == 0
        const podKeys = new Set()
        for (const cluster of clusters) {
            for (const node of Object.values(cluster.nodes)) {
                for (const pod of Object.values(node.pods)) {
                    podKeys.add(cluster.id + '/' + pod.namespace + '/' + pod.name)
                }
            }
            for (const pod of Object.values(cluster.unassigned_pods)) {
                podKeys.add(cluster.id + '/' + pod.namespace + '/' + pod.name)
            }
        }
        for (const key of Object.keys(ALL_PODS)) {
            const pod = ALL_PODS[key]
            if (!podKeys.has(key)) {
                // pod was deleted
                delete ALL_PODS[key]
                this.seenPods.delete(key)
                if (changes < 10) {
                    // NOTE: we need to do this BEFORE removeChildren()
                    // to get correct global coordinates
                    const globalPos = pod.toGlobal({x: 0, y: 0})
                    window.setTimeout(function() {
                        that.animatePodDeletion(pod, globalPos)
                    }, 100 * changes)
                } else {
                    pod.destroy()
                }
                changes++
            }
        }
        const clusterComponentById = {}
        for (const component of this.viewContainer.children) {
            clusterComponentById[component.cluster.id] = component
        }
        let y = 0
        const clusterIds = new Set()
        for (const cluster of clusters) {
            if (!this.selectedClusters.size || this.selectedClusters.has(cluster.id)) {
                clusterIds.add(cluster.id)
                let clusterBox = clusterComponentById[cluster.id]
                if (!clusterBox) {
                    clusterBox = new Cluster(cluster, this.tooltip)
                    this.viewContainer.addChild(clusterBox)
                } else {
                    clusterBox.cluster = cluster
                }
                clusterBox.draw()
                clusterBox.x = 0
                clusterBox.y = y
                y += clusterBox.height + 10
            }
        }
        for (const component of this.viewContainer.children) {
            if (!clusterIds.has(component.cluster.id)) {
                this.viewContainer.removeChild(component)
            }
        }
        this.filter()

        for (const key of Object.keys(ALL_PODS)) {
            const pod = ALL_PODS[key]
            if (!this.seenPods.has(key)) {
                // pod was created
                this.seenPods.add(key)
                if (!firstTime && changes < 10) {
                    const globalPos = pod.toGlobal({x: 0, y: 0})
                    window.setTimeout(function() {
                        that.animatePodCreation(pod, globalPos)
                    }, 100 * changes)
                }
                changes++
            }
        }
    }

    tick(time) {
        this.renderer.render(this.stage)
    }

    changeSorting(newSortFunction) {
        this.sorterFn = newSortFunction
        this.update()
    }

    switchTheme(newTheme) {
        this.theme = Theme.get(newTheme)
        this.draw()
        this.update()
        localStorage.setItem('theme', newTheme)
    }

    toggleCluster(clusterId) {
        if (this.selectedClusters.has(clusterId)) {
            this.selectedClusters.delete(clusterId)
        } else {
            this.selectedClusters.add(clusterId)
        }
        this.changeLocationHash('clusters', Array.from(this.selectedClusters).join(','))
        // make sure we are updating our EventSource filter
        this.connect()
        this.update()
    }

    keepAlive() {
        if (this.keepAliveTimer != null) {
            clearTimeout(this.keepAliveTimer)
        }
        this.keepAliveTimer = setTimeout(this.connect.bind(this), this.keepAliveSeconds * 1000)
    }

    disconnect() {
        if (this.eventSource != null) {
            this.eventSource.close()
            this.eventSource = null
        }
    }

    connect() {
        // first close the old connection
        this.disconnect()
        const that = this
        // NOTE: path must be relative to work with kubectl proxy out of the box
        let url = 'events'
        const clusterIds = Array.from(this.selectedClusters).join(',')
        if (clusterIds) {
            url += '?cluster_ids=' + clusterIds
        }
        const eventSource = this.eventSource = new EventSource(url, {credentials: 'include'})
        this.keepAlive()
        eventSource.onerror = function(event) {
            that._errors++
            if (that._errors <= 1) {
                // immediately reconnect on first error
                that.connect()
            } else {
                // rely on keep-alive timer to reconnect
                that.disconnect()
            }
        }
        eventSource.addEventListener('clusterupdate', function(event) {
            that._errors = 0
            that.keepAlive()
            const cluster = JSON.parse(event.data)
            that.clusters.set(cluster.id, cluster)
            that.update()
        })
        eventSource.addEventListener('clusterdelta', function(event) {
            that._errors = 0
            that.keepAlive()
            const data = JSON.parse(event.data)
            let cluster = that.clusters.get(data.cluster_id)
            if (cluster && data.delta) {
                // deep copy cluster object (patch function mutates inplace!)
                cluster = JSON.parse(JSON.stringify(cluster))
                cluster = JSON_delta.patch(cluster, data.delta)
                that.clusters.set(cluster.id, cluster)
                that.update()
            }
        })
    }

    run() {
        this.initialize()
        this.draw()
        this.connect()

        PIXI.ticker.shared.add(this.tick, this)
    }
}

module.exports = App
