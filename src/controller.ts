import { Adapter } from "./adapter"
import { BrowserAdapter } from "./browser_adapter"
import { FormSubmitObserver } from "./form_submit_observer"
import { History } from "./history"
import { LinkClickObserver } from "./link_click_observer"
import { Location, Locatable } from "./location"
import { Navigator } from "./navigator"
import { PageObserver } from "./page_observer"
import { RenderCallback } from "./renderer"
import { ScrollObserver } from "./scroll_observer"
import { Action, Position, isAction } from "./types"
import { closest, dispatch, uuid } from "./util"
import { RenderOptions, View } from "./view"
import { Visit } from "./visit"

export type RestorationData = { scrollPosition?: Position }
export type RestorationDataMap = { [uuid: string]: RestorationData }
export type TimingData = {}
export type VisitOptions = { action: Action }
export type VisitProperties = { restorationIdentifier: string, restorationData: RestorationData, historyChanged: boolean }

export class Controller {
  static supported = !!(
    window.history.pushState &&
    window.requestAnimationFrame &&
    window.addEventListener
  )

  readonly navigator = new Navigator(this)
  readonly adapter: Adapter = new BrowserAdapter(this)
  readonly history = new History(this)
  readonly restorationData: RestorationDataMap = {}
  readonly view = new View(this)

  readonly pageObserver = new PageObserver(this)
  readonly linkClickObserver = new LinkClickObserver(this)
  readonly formSubmitObserver = new FormSubmitObserver(this)
  readonly scrollObserver = new ScrollObserver(this)

  currentVisit?: Visit
  enabled = true
  location!: Location
  progressBarDelay = 500
  restorationIdentifier!: string
  started = false

  start() {
    if (Controller.supported && !this.started) {
      this.pageObserver.start()
      this.linkClickObserver.start()
      this.formSubmitObserver.start()
      this.scrollObserver.start()
      this.startHistory()
      this.started = true
      this.enabled = true
    }
  }

  disable() {
    this.enabled = false
  }

  stop() {
    if (this.started) {
      this.pageObserver.stop()
      this.linkClickObserver.stop()
      this.formSubmitObserver.stop()
      this.scrollObserver.stop()
      this.stopHistory()
      this.started = false
    }
  }

  clearCache() {
    this.view.clearSnapshotCache()
  }

  visit(location: Locatable, options: Partial<VisitOptions> = {}) {
    location = Location.wrap(location)
    if (this.applicationAllowsVisitingLocation(location)) {
      if (this.locationIsVisitable(location)) {
        const action = options.action || "advance"
        this.adapter.visitProposedToLocationWithAction(location, action)
      } else {
        window.location.href = location.toString()
      }
    }
  }

  startVisitToLocationWithAction(location: Locatable, action: Action, restorationIdentifier: string) {
    if (Controller.supported) {
      const restorationData = this.getRestorationDataForIdentifier(restorationIdentifier)
      this.startVisit(Location.wrap(location), action, { restorationData })
    } else {
      window.location.href = location.toString()
    }
  }

  setProgressBarDelay(delay: number) {
    this.progressBarDelay = delay
  }

  // History

  startHistory() {
    this.location = Location.currentLocation
    this.restorationIdentifier = uuid()
    this.history.start()
    this.history.replace(this.location, this.restorationIdentifier)
  }

  stopHistory() {
    this.history.stop()
  }

  pushHistoryWithLocationAndRestorationIdentifier(locatable: Locatable, restorationIdentifier: string) {
    this.location = Location.wrap(locatable)
    this.restorationIdentifier = restorationIdentifier
    this.history.push(this.location, this.restorationIdentifier)
  }

  replaceHistoryWithLocationAndRestorationIdentifier(locatable: Locatable, restorationIdentifier: string) {
    this.location = Location.wrap(locatable)
    this.restorationIdentifier = restorationIdentifier
    this.history.replace(this.location, this.restorationIdentifier)
  }

  // History delegate

  historyPoppedToLocationWithRestorationIdentifier(location: Location, restorationIdentifier: string) {
    if (this.enabled) {
      this.location = location
      this.restorationIdentifier = restorationIdentifier
      const restorationData = this.getRestorationDataForIdentifier(restorationIdentifier)
      this.startVisit(location, "restore", { restorationIdentifier, restorationData, historyChanged: true })
    } else {
      this.adapter.pageInvalidated()
    }
  }

  // Scroll observer delegate

  scrollPositionChanged(position: Position) {
    const restorationData = this.getCurrentRestorationData()
    restorationData.scrollPosition = position
  }

  // Link click observer delegate

  willFollowLinkToLocation(link: Element, location: Location) {
    return this.linkIsVisitable(link)
      && this.locationIsVisitable(location)
      && this.applicationAllowsFollowingLinkToLocation(link, location)
  }

  didFollowLinkToLocation(link: Element, location: Location) {
    const action = this.getActionForLink(link)
    this.visit(location, { action })
  }

  // Form submit observer delegate

  willSubmitForm(form: HTMLFormElement) {
    return true
  }

  formSubmitted(form: HTMLFormElement) {
    this.navigator.submit(form)
  }

  // Page observer delegate

  pageBecameInteractive() {
    this.view.lastRenderedLocation = this.location
    this.notifyApplicationAfterPageLoad()
  }

  pageLoaded() {

  }

  pageInvalidated() {
    this.adapter.pageInvalidated()
  }

  // View

  render(options: Partial<RenderOptions>, callback: RenderCallback) {
    this.view.render(options, callback)
  }

  viewWillRender(newBody: HTMLBodyElement) {
    this.notifyApplicationBeforeRender(newBody)
  }

  viewRendered() {
    this.view.lastRenderedLocation = this.currentVisit!.location
    this.notifyApplicationAfterRender()
  }

  viewInvalidated() {
    this.pageObserver.invalidate()
  }

  viewWillCacheSnapshot() {
    this.notifyApplicationBeforeCachingSnapshot()
  }

  // Application events

  applicationAllowsFollowingLinkToLocation(link: Element, location: Location) {
    const event = this.notifyApplicationAfterClickingLinkToLocation(link, location)
    return !event.defaultPrevented
  }

  applicationAllowsVisitingLocation(location: Location) {
    const event = this.notifyApplicationBeforeVisitingLocation(location)
    return !event.defaultPrevented
  }

  notifyApplicationAfterClickingLinkToLocation(link: Element, location: Location) {
    return dispatch("turbolinks:click", { target: link, data: { url: location.absoluteURL }, cancelable: true })
  }

  notifyApplicationBeforeVisitingLocation(location: Location) {
    return dispatch("turbolinks:before-visit", { data: { url: location.absoluteURL }, cancelable: true })
  }

  notifyApplicationAfterVisitingLocation(location: Location) {
    return dispatch("turbolinks:visit", { data: { url: location.absoluteURL } })
  }

  notifyApplicationBeforeCachingSnapshot() {
    return dispatch("turbolinks:before-cache")
  }

  notifyApplicationBeforeRender(newBody: HTMLBodyElement) {
    return dispatch("turbolinks:before-render", { data: { newBody }})
  }

  notifyApplicationAfterRender() {
    return dispatch("turbolinks:render")
  }

  notifyApplicationAfterPageLoad(timing: TimingData = {}) {
    return dispatch("turbolinks:load", { data: { url: this.location.absoluteURL, timing }})
  }

  // Private

  startVisit(location: Location, action: Action, properties: Partial<VisitProperties>) {
    if (this.currentVisit) {
      this.currentVisit.cancel()
    }
    this.currentVisit = this.createVisit(location, action, properties)
    this.currentVisit.start()
    this.notifyApplicationAfterVisitingLocation(location)
  }

  createVisit(location: Location, action: Action, properties: Partial<VisitProperties>): Visit {
    const visit = new Visit(this, location, action, properties.restorationIdentifier)
    visit.restorationData = { ...(properties.restorationData || {}) }
    visit.historyChanged = !!properties.historyChanged
    visit.referrer = this.location
    return visit
  }

  visitCompleted(visit: Visit) {
    this.notifyApplicationAfterPageLoad(visit.getTimingMetrics())
  }

  getActionForLink(link: Element): Action {
    const action = link.getAttribute("data-turbolinks-action")
    return isAction(action) ? action : "advance"
  }

  linkIsVisitable(link: Element) {
    const container = closest(link, "[data-turbolinks]")
    if (container) {
      return container.getAttribute("data-turbolinks") != "false"
    } else {
      return true
    }
  }

  locationIsVisitable(location: Location) {
    return location.isPrefixedBy(this.view.getRootLocation()) && location.isHTML()
  }

  getCurrentRestorationData(): RestorationData {
    return this.getRestorationDataForIdentifier(this.restorationIdentifier)
  }

  getRestorationDataForIdentifier(identifier: string): RestorationData {
    if (!(identifier in this.restorationData)) {
      this.restorationData[identifier] = {}
    }
    return this.restorationData[identifier]
  }
}
