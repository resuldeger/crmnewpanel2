import { useMemo, useCallback } from 'react';
import { FormStep, FormData } from '../types';
import { isBrowser, searchParams } from '../lib/browser';

export interface StudioContext {
  /** short studio name, e.g. "Tacoma" */
  name: string;
  city: string;
  country: string;
}

const UNKNOWN_STUDIO: StudioContext = { name: '', city: '', country: 'United States' };

/**
 * GTM events. The studio now arrives as an argument — it used to be read off
 * `window.__BOOKING_LOCATION__`, a global the Laravel layout injected, which
 * meant analytics reported empty studio names whenever the SPA ran on its own.
 */
export function useDataLayer(studio: StudioContext = UNKNOWN_STUDIO) {
  const bookingFlow = useMemo(() => {
    const params = searchParams();
    const paidParams = ['utm_source','page_form', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'gclid', 'fbclid', 'ttclid', 'x', 'vip'];
    const isPaid = paidParams.some(p => params.has(p));
    return isPaid ? 'lead_flow_v1' : 'organic_flow_v1';
  }, []);

  const getServiceType = (purpose: string) => {
    if (!purpose) return null;
    if (purpose === 'piercing') return 'piercing';
    // Mapping internal keys to documentation keys
    // App.tsx defaults: first, adding, cover, explore
    // Documentation: new_tattoo, touch_up, cover_up
    const tattooKeys = ['new_tattoo', 'touch_up', 'cover_up', 'first', 'adding', 'cover', 'explore'];
    if (tattooKeys.includes(purpose)) return 'tattoo';
    return 'tattoo'; // Default to tattoo if not piercing
  };

  const getStepName = (step: FormStep, purpose: string) => {
    switch (step) {
      case FormStep.WELCOME: return 'landing';
      case FormStep.PURPOSE: return 'visit_purpose';
      case FormStep.STYLE: return purpose === 'piercing' ? 'piercing_category' : 'style_select';
      case FormStep.STORY: return 'tell_your_story';
      case FormStep.BODY_AREA: return 'placement';
      case FormStep.SIZE: return 'dimensions';
      case FormStep.TIMING: return 'datetime_select';
      case FormStep.CONTACT: return 'contact_info';
      case FormStep.SUCCESS: return 'booking_success';
      default: return 'unknown';
    }
  };

  const pushEvent = (eventData: Record<string, unknown>) => {
    if (!isBrowser || !window.dataLayer) return;
    // These payloads carry the visitor's name, email and phone. Logging them
    // in production put customer PII in every visitor's browser console.
    if (process.env.NODE_ENV !== "production") console.debug(`[DataLayer] ${eventData.event}`, eventData);
    window.dataLayer.push(eventData);
  };

  const trackStepView = useCallback((step: FormStep, formData: FormData, stepIndex: number) => {
    const purpose = formData.purpose;
    const serviceType = getServiceType(purpose);
    const stepName = getStepName(step, purpose);

    /* GTM payloads grow per step below, so the shape is open by design. */
    const payload: Record<string, unknown> = {
      event: 'booking_step_view',
      bookingFlow,
      serviceType: serviceType,
      funnelStepName: stepName,
      funnelStepIndex: stepIndex,
      funnelStepRealIndex: stepIndex,
      studio: studio.name,
      studioCity: studio.city,
      studioCountry: studio.country,
    };

    if (step === FormStep.WELCOME) {
      pushEvent({
        ...payload,
        event: 'booking_start',
        funnelStepName: 'landing',
        funnelStepIndex: undefined,
      });
    } else {
      pushEvent(payload);
    }
  }, [bookingFlow]);

  const trackStepComplete = useCallback((step: FormStep, formData: FormData, stepIndex: number) => {
    const purpose = formData.purpose;
    const serviceType = getServiceType(purpose);
    const stepName = getStepName(step, purpose);
    /* GTM payloads grow per step below, so the shape is open by design. */
    const payload: Record<string, unknown> = {
      event: 'booking_step_complete',
      bookingFlow,
      serviceType: serviceType,
      funnelStepName: stepName,
      funnelStepIndex: stepIndex,
      funnelStepRealIndex: stepIndex,
      studio: studio.name,
    };

    // Add step-specific data
    switch (step) {
      case FormStep.PURPOSE:
      case FormStep.STORY:
        payload.selectedOption = step === FormStep.PURPOSE ? formData.purpose : formData.storyType;
        break;
      case FormStep.STYLE:
        if (purpose === 'piercing') {
          payload.selectedCategory = formData.style;
        } else {
          payload.selectedStyle = formData.style;
        }
        break;
      case FormStep.BODY_AREA:
        payload.selectedPlacements = formData.bodyArea;
        payload.placementCount = formData.bodyArea.length;
        break;
      case FormStep.SIZE:
        payload.selectedDimension = formData.size;
        break;
      case FormStep.TIMING:
        payload.selectedDate = formData.selectedDate;
        payload.selectedTime = formData.selectedTime;
        payload.timeZone = formData.timezone;
        break;
    }

    pushEvent(payload);
  }, [bookingFlow]);

  const trackSubmit = useCallback((formData: FormData, stepIndex: number) => {
    const purpose = formData.purpose;
    const serviceType = getServiceType(purpose);
    const stepName = getStepName(FormStep.TIMING, purpose); // Usually submitted after timing or contact

    pushEvent({
      event: 'booking_submit',
      bookingFlow,
      serviceType: serviceType,
      funnelStepName: stepName,
      funnelStepIndex: stepIndex,
      funnelStepRealIndex: stepIndex,
      selectedDate: formData.selectedDate,
      selectedTime: formData.selectedTime,
      timeZone: formData.timezone,
      studio: studio.name,
    });
  }, [bookingFlow]);

  const trackSuccess = useCallback((formData: FormData, bookingId: string) => {
    const purpose = formData.purpose;
    const serviceType = getServiceType(purpose);

    pushEvent({
      event: 'booking_success',
      bookingFlow,
      serviceType: serviceType,
      bookingId: bookingId,
      studio: studio.name,
    });
  }, [bookingFlow]);

  return {
    trackStepView,
    trackStepComplete,
    trackSubmit,
    trackSuccess,
  };
}
