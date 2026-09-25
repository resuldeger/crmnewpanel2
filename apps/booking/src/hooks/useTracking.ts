import { useState, useEffect, useRef } from 'react';
import type { FormData } from '../types';
import { api } from '../lib/env';
import { toE164Phone } from '../utils/validation';

/**
 * What the abandonment tracker is allowed to send.
 *
 * The old version posted the ENTIRE form object on every step change and
 * again 1s after every keystroke — full name, email and phone, repeatedly,
 * for visitors who never agreed to anything. This sends the answers needed
 * for the funnel report plus the contact fields exactly once they are
 * complete enough to be worth anything.
 */
function trackablePayload(form: FormData | undefined) {
  if (!form) return {};
  const phone = form.phone ? toE164Phone(form.phone) : '';
  const email = form.email?.trim() ?? '';
  return {
    purpose: form.purpose || null,
    style: form.style || null,
    story_type: form.storyType || null,
    body_areas: form.bodyArea?.length ? form.bodyArea : null,
    size: form.size || null,
    preferred_date: form.selectedDate || null,
    preferred_time: form.selectedTime || null,
    timezone: form.timezone || null,
    has_reference_image: Boolean(form.referenceImage),
    // contact is only worth storing once it can actually be used
    full_name: form.fullName?.trim().length >= 2 ? form.fullName.trim() : null,
    email: email.includes('@') ? email : null,
    phone: phone.length >= 8 ? phone : null,
    sms_consent: Boolean(form.smsConsent),
  };
}

export function useTracking(locationSlug: string, currentStep: number, formData?: FormData) {
  const [sessionUuid, setSessionUuid] = useState<string | null>(null);
  const lastInitKey = useRef<string>('');
  const lastSentData = useRef<string>('');
  const lastSentStep = useRef<number | null>(null);

  // Initialize tracking session on component mount or location/query change
  useEffect(() => {
    if (!locationSlug) return;
    const currentKey = `${locationSlug}_${window.location.search}`;
    if (lastInitKey.current === currentKey) return;
    lastInitKey.current = currentKey;

    const params = new URLSearchParams(window.location.search);
    
    // Comprehensive Ad Tracking Parameters
    const extraData: Record<string, string> = {};
    params.forEach((value, key) => {
      extraData[key] = value;
    });

    const gClickId = params.get('gclid') || params.get('gbraid') || params.get('wbraid') || params.get('dclid');
    const isGoogleAds = !!(gClickId || params.get('gad_source') || params.get('gad_campaignid') || params.get('gad_network'));

    const payload = {
      location_slug: locationSlug,
      utm_source: params.get('utm_source') || (isGoogleAds ? 'google' : null),
      utm_medium: params.get('utm_medium') || (isGoogleAds ? 'cpc' : null),
      utm_campaign: params.get('utm_campaign') || params.get('gad_campaignid') || params.get('campaign_id') || params.get('tt_campaign'),
      utm_term: params.get('utm_term') || params.get('gad_keyword') || params.get('tt_term'),
      utm_content: params.get('utm_content') || params.get('gad_creative') || params.get('tt_content'),
      utm_id: params.get('utm_id') || params.get('gad_campaignid') || params.get('campaign_id'),
      gclid: gClickId,
      fbclid: params.get('fbclid'),
      msclkid: params.get('msclkid'),
      ttclid: params.get('ttclid'),
      sccid: params.get('sccid'),
      epik: params.get('epik'),
      twclid: params.get('twclid'),
      landing_url: typeof window !== 'undefined' ? window.location.href : null,
      initial_step: currentStep.toString(),
      extra_data: Object.keys(extraData).length > 0 ? JSON.stringify(extraData) : null
    };

    fetch(api('/api/booking/sessions'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    })
      .then(res => res.json())
      .then(data => {
        if (data.session_uuid) {
          setSessionUuid(data.session_uuid);
        }
      })
      .catch(err => {
        console.warn('Analytics mapping failed', err);
      });
  }, [locationSlug]);

  const sendStepUpdate = (stepToSend: number, dataToSend?: FormData) => {
    if (!sessionUuid) return;
    const currentDataStr = JSON.stringify(dataToSend || {});
    
    lastSentStep.current = stepToSend;
    lastSentData.current = currentDataStr;

    fetch(api(`/api/booking/sessions/${sessionUuid}/step`), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        step: stepToSend.toString(),
        location_slug: locationSlug,
        landing_url: typeof window !== 'undefined' ? window.location.href : null,
        form_data: trackablePayload(dataToSend),
        _it: (dataToSend as { _it?: boolean } | undefined)?._it ?? true,
      })
    })
    .catch(err => console.warn('Analytics map step update failed', err));
  };

  // 1. Step change: Send IMMEDIATELY whenever user goes forward or backward to any step
  useEffect(() => {
    if (!sessionUuid) return;
    
    if (lastSentStep.current !== currentStep) {
      sendStepUpdate(currentStep, formData);
    }
  }, [currentStep, sessionUuid]);

  // 2. Form data change on same step: Debounce so keystrokes don't flood the server
  useEffect(() => {
    if (!sessionUuid) return;
    const currentDataStr = JSON.stringify(formData || {});

    // If step changed, the step useEffect handles it immediately
    if (lastSentStep.current !== currentStep) return;

    // If data hasn't changed, skip
    if (lastSentData.current === currentDataStr) return;

    const handler = setTimeout(() => {
      sendStepUpdate(currentStep, formData);
    }, 1000);

    return () => {
      clearTimeout(handler);
    };
  }, [formData, currentStep, sessionUuid, locationSlug]);

  return { sessionUuid };
}
