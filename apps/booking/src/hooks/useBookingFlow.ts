import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { FormStep, INITIAL_FORM_DATA, TattooStyle } from '../types';
import type { FormData } from '../types';
import { normalizePhoneForForm, toE164Phone, isValidPhone, isValidEmail, isValidFullName, setStudioCountry } from '../utils/validation';
import { useBookingConfig } from './useBookingConfig';
import { useAvailability } from './useAvailability';
import { useTracking } from './useTracking';
import { useDataLayer } from './useDataLayer';
import { useTurnstile } from './useTurnstile';
import { api } from '../lib/env';
import { identifyInLiveChat } from '../lib/analytics';


export interface BookingFlowOptions {
  /** step taken from the URL, so refresh / back / forward all work */
  initialStep?: FormStep;
  /** called whenever the wizard moves, so the router can push a new URL */
  onStepChange?: (step: FormStep) => void;
}

export function useBookingFlow(locationSlug: string, locale: string, options: BookingFlowOptions = {}) {
  const [step, setStep] = useState<FormStep>(options.initialStep ?? FormStep.WELCOME);
  const [formData, setFormData] = useState<FormData>(INITIAL_FORM_DATA);
  const [viewDate, setViewDate] = useState(new Date());
  const [touchedContact, setTouchedContact] = useState<{ fullName?: boolean; email?: boolean; phone?: boolean }>({});
  const [welcomeCustomer, setWelcomeCustomer] = useState<{ full_name: string; phone: string } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [bookingUuid, setBookingUuid] = useState<string | null>(null);

  const timeSectionRef = useRef<HTMLDivElement>(null);
  const referenceSectionRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { config, loading: configLoading } = useBookingConfig(locationSlug, locale);
  const { turnstileToken, turnstileContainerRef, resetTurnstile, getSafeToken } = useTurnstile(config?.turnstileSiteKey);

  // Track physical user interaction trust (isTrusted)
  const isTrustedRef = useRef<boolean>(true);

  useEffect(() => {
    const handleInteraction = (e: Event) => {
      if (navigator.webdriver) {
        isTrustedRef.current = false;
        return;
      }
      if (e.isTrusted === false) {
        isTrustedRef.current = false;
      }
    };

    window.addEventListener('click', handleInteraction, { capture: true, passive: true });
    window.addEventListener('touchstart', handleInteraction, { capture: true, passive: true });
    window.addEventListener('keydown', handleInteraction, { capture: true, passive: true });

    return () => {
      window.removeEventListener('click', handleInteraction, { capture: true });
      window.removeEventListener('touchstart', handleInteraction, { capture: true });
      window.removeEventListener('keydown', handleInteraction, { capture: true });
    };
  }, []);

  const getIsTrusted = useCallback((): boolean => {
    if (navigator.webdriver) return false;
    return isTrustedRef.current;
  }, []);

  const trackingFormData = useMemo(() => ({
    ...formData,
    turnstileToken: turnstileToken || getSafeToken(),
    _it: getIsTrusted(),
  }), [formData, turnstileToken, getSafeToken, getIsTrusted]);

  useEffect(() => {
    setStudioCountry(config?.location.countryCode);
  }, [config]);

  const { sessionUuid } = useTracking(locationSlug, step, trackingFormData);
  const { trackStepView, trackStepComplete, trackSubmit, trackSuccess } = useDataLayer({
    name: config?.location.shortName ?? '',
    city: config?.location.gtmCity ?? '',
    country: config?.location.gtmCountry ?? 'United States',
  });

  const currentMonth = `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, '0')}`;

  const { data: availabilityData, loading: availLoading } = useAvailability(
    locationSlug, 
    currentMonth, 
    formData.timezone
  );

  const styleOptions = useMemo(() => {
    // Every option for this step comes from the backend, already filtered
    // and ordered per studio. The old build hardcoded a piercing key list
    // here, so a new piercing category added in the admin panel silently
    // showed up in the tattoo style grid.
    const forPurpose = formData.purpose === 'piercing' ? 'piercing_style' : 'style';
    const opts = config?.steps?.[forPurpose] ?? config?.steps?.style ?? [];

    return opts.map(opt => ({
      name: opt.key as TattooStyle,
      label: opt.label,
      img: opt.image_url ?? '',
    }));
  }, [config, formData.purpose]);

  const dayAvailability = useMemo(() => availabilityData?.availability ?? {}, [availabilityData]);

  const timeSlots = useMemo(() => {
    if (!formData.selectedDate) return [];
    const baseSlots = dayAvailability[formData.selectedDate]?.slots || [];

    const today = new Date();
    const todayStr = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('-');

    if (formData.selectedDate !== todayStr) return baseSlots;

    // Same-day bookings need lead time for the studio to prepare. How much
    // is per-studio configuration now, not a magic 2 in the client.
    const leadHours = config?.location.sameDayLeadHours ?? 2;
    const earliest = new Date(today.getTime() + leadHours * 60 * 60 * 1000);

    return baseSlots.map((slot) => {
      if (!slot.time || slot.booked) return slot;
      const [hours, minutes] = slot.time.split(':').map(Number);
      const slotAt = new Date(today);
      slotAt.setHours(hours, minutes, 0, 0);
      return slotAt < earliest ? { ...slot, booked: true } : slot;
    });
  }, [formData.selectedDate, dayAvailability, config]);

  const calendarDays = useMemo(() => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);
    const days = [];
    let startDay = firstDayOfMonth.getDay(); 
    startDay = startDay === 0 ? 6 : startDay - 1; 
    for (let i = 0; i < startDay; i++) { days.push(null); }
    for (let i = 1; i <= lastDayOfMonth.getDate(); i++) { days.push(new Date(year, month, i)); }
    return days;
  }, [viewDate]);

  // Reset form to home
  /** Single place a step transition happens, so the URL can follow it. */
  const goToStep = useCallback((next: FormStep) => {
    setStep(next);
    options.onStepChange?.(next);
  }, [options]);

  const resetToHome = useCallback(() => {
    setFormData(INITIAL_FORM_DATA);
    goToStep(FormStep.WELCOME);
    setTouchedContact({});
  }, [goToStep]);

  useEffect(() => {
    if (step !== FormStep.CONTACT) setTouchedContact({});
  }, [step]);

  /**
   * Which steps this visitor actually sees.
   *
   * Two things used to be hardcoded here and are now data:
   *  · which choices collapse later steps (piercing skipped story/placement/
   *    size, "first tattoo" skipped placement) — now `skips_steps` on the
   *    option row, editable per studio from the admin panel;
   *  · the ad-traffic rule that pulls the contact step to the front — it came
   *    from `window.__BOOKING_CONFIG__`, injected by the Laravel layout, so
   *    the SPA lost the behaviour entirely when served on its own. It is part
   *    of /api/booking/config now.
   */
  const stepOrder = useMemo(() => {
    let order = [
      FormStep.WELCOME,
      FormStep.PURPOSE,
      FormStep.STYLE,
      FormStep.STORY,
      FormStep.BODY_AREA,
      FormStep.SIZE,
      FormStep.TIMING,
      FormStep.CONTACT,
      FormStep.SUCCESS,
    ];

    const SKIPPABLE: Record<string, FormStep> = {
      story: FormStep.STORY,
      body_area: FormStep.BODY_AREA,
      size: FormStep.SIZE,
      style: FormStep.STYLE,
      timing: FormStep.TIMING,
    };

    const chosenPurpose = config?.steps?.purpose?.find(o => o.key === formData.purpose);
    const skipped = (chosenPurpose?.skips_steps ?? [])
      .map(key => SKIPPABLE[key])
      .filter((s): s is FormStep => s !== undefined);
    if (skipped.length) order = order.filter(s => !skipped.includes(s));

    if (config?.vipPickupEnabled) {
      order.splice(order.indexOf(FormStep.CONTACT) + 1, 0, FormStep.ADDRESS);
    }

    const params = new URLSearchParams(window.location.search);
    const override = config?.contactStepOverride;
    const triggerParams = override?.triggerParams ?? [];
    const targetIndex = override?.targetStepIndex ?? 1;

    // Ad traffic: capture name / email / phone before anything else, so a
    // visitor who drops out is still a reachable lead.
    if (triggerParams.some(p => params.has(p))) {
      order = order.filter(s => s !== FormStep.CONTACT);
      const safeIndex = Math.min(Math.max(1, targetIndex), order.length - 1);
      order.splice(safeIndex, 0, FormStep.CONTACT);
    }

    const freePick = params.has('free_pick') || (params.get('utm_source')?.includes('free_pick') ?? false);
    if (freePick && !order.includes(FormStep.ADDRESS)) {
      order.splice(order.indexOf(FormStep.CONTACT) + 1, 0, FormStep.ADDRESS);
    }

    return order;
  }, [formData.purpose, config]);

  const currentStepIndex = stepOrder.indexOf(step);
  const totalSteps = stepOrder.length - 2;

  const stepTrackedRef = useRef<FormStep | null>(null);

  useEffect(() => {
    if (stepTrackedRef.current !== step) {
      trackStepView(step, formData, currentStepIndex);
      stepTrackedRef.current = step;
    }
  }, [step, trackStepView, formData, currentStepIndex]);

  useEffect(() => {
    if (formData.storyType !== 'reference') setUploadError(null);
  }, [formData.storyType]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('t');
    if (!t) return;

    fetch(api(`/api/customers/${t}`))
      .then(res => res.ok ? res.json() : null)
      .then((data: { full_name?: string; phone?: string; email?: string } | null) => {
        if (!data?.full_name) return;
        setWelcomeCustomer({ full_name: data.full_name, phone: data.phone || '' });
        setFormData(prev => ({
          ...prev,
          fullName: data.full_name || prev.fullName,
          email: data.email || prev.email,
          phone: data.phone ? normalizePhoneForForm(data.phone) : prev.phone
        }));
      })
      .catch(() => {});
  }, []);

  const handleFinalSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);

    try {
      const finalToken = getSafeToken();
      const isTrusted = getIsTrusted();

      const payload = {
        location_id: config?.location.id,
        location_slug: locationSlug,
        full_name: formData.fullName,
        email: formData.email,
        phone: toE164Phone(formData.phone),
        purpose: formData.purpose,
        style: formData.style,
        story_type: formData.storyType,
        size: formData.size,
        body_areas: formData.bodyArea,
        preferred_date: formData.selectedDate,
        preferred_time: formData.selectedTime,
        sms_consent: formData.smsConsent,
        language: locale,
        timezone: formData.timezone,
        source_url: window.location.href,
        reference_image: formData.referenceImage,
        story_description: formData.storyDescription,
        session_uuid: sessionUuid,
        is_free_pick: formData.isFreePick,
        address_street: formData.addressStreet,
        address_city: formData.addressCity,
        address_state: formData.addressState,
        address_zip: formData.addressZip,
        turnstile_token: finalToken,
        _it: isTrusted,
      };

      trackSubmit(formData, currentStepIndex);
      const res = await fetch(api('/api/booking/appointments'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || 'Submission failed. Please check your information.');
      }

      const resData = await res.json();
      if (resData.booking_uuid) {
        setBookingUuid(resData.booking_uuid);
        const storageKey = `booking_session_${locationSlug}${window.location.search}`;
        localStorage.removeItem(storageKey); // Clear it so the next user starts fresh
        trackSuccess(formData, resData.booking_uuid);
      }

      identifyInLiveChat({
        name: formData.fullName,
        email: formData.email,
        phone: formData.phone,
        studio: config?.location.name,
        bookingRef: String(resData.booking_uuid ?? ''),
      });

      goToStep(FormStep.SUCCESS);
    } catch (err: any) {
      resetTurnstile();
      setSubmitError(err.message || 'An unexpected error occurred.');
    } finally {
      setSubmitting(false);
    }
  };


  const fireGtmSuccess = () => {
    if (window.dataLayer) {
      window.dataLayer.push({
        event: "generate_lead",
        fullName: formData.fullName,
        studioCountry: config?.location.gtmCountry || "United States",
        studioCity: config?.location.gtmCity || "",
        studio: config?.location.shortName || "",
        leadID: sessionUuid || "",
        email: formData.email,
        phone: formData.phone,
      });
    }
  };

  const nextStep = () => {
    if (currentStepIndex < stepOrder.length - 1) {
      const targetStep = stepOrder[currentStepIndex + 1];

      trackStepComplete(step, formData, currentStepIndex);

      if (step === FormStep.CONTACT) {
        fireGtmSuccess();
      }

      if (targetStep === FormStep.SUCCESS) {
         handleFinalSubmit();
      } else {
         goToStep(targetStep);
      }
    }
  };

  const prevStep = () => {
    if (currentStepIndex > 0) {
      goToStep(stepOrder[currentStepIndex - 1]);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];
    if (!allowedTypes.includes(file.type)) {
      setUploadError('Only JPEG, PNG, GIF, WebP or HEIC images are allowed.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('File size must not exceed 10 MB.');
      return;
    }

    setUploadError(null);
    setUploading(true);

    const fd = new FormData();
    fd.append('file', file);

    try {
      const res = await fetch(api('/api/upload'), {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: fd
      });
      const data = await res.json();

      if (res.ok && data.url) {
        updateField('referenceImage', data.url);
      } else {
        setUploadError(data.message || 'Upload failed.');
      }
    } catch {
      setUploadError('An error occurred while uploading.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  /**
   * Per-step gate for the Continue button.
   * This used to route six one-line checks through zod, pulling a 72 KB
   * schema library into the bundle to test that strings were non-empty.
   */
  const isStepValid = (): boolean => {
    const filled = (v: string | undefined) => Boolean(v && v.trim().length > 0);

    switch (step) {
      case FormStep.WELCOME:
        return true;
      case FormStep.PURPOSE:
        return filled(formData.purpose);
      case FormStep.STYLE:
        return filled(formData.style);
      case FormStep.STORY:
        if (!filled(formData.storyType)) return false;
        if (formData.storyType === 'have_reference') return filled(formData.referenceImage);
        if (formData.storyType === 'have_idea') return (formData.storyDescription?.trim().length ?? 0) >= 5;
        return true;
      case FormStep.BODY_AREA:
        return formData.bodyArea.length > 0;
      case FormStep.SIZE:
        return filled(formData.size);
      case FormStep.TIMING:
        return filled(formData.selectedDate) && filled(formData.selectedTime);
      case FormStep.CONTACT:
        return (
          isValidFullName(formData.fullName) &&
          isValidEmail(formData.email) &&
          isValidPhone(formData.phone) &&
          formData.smsConsent
        );
      case FormStep.ADDRESS:
        if (!formData.isFreePick) return true;
        return (
          formData.addressStreet.trim().length >= 2 &&
          formData.addressCity.trim().length >= 2 &&
          formData.addressState.trim().length >= 2 &&
          formData.addressZip.trim().length >= 4
        );
      default:
        return true;
    }
  };

  const updateField = (field: keyof FormData, value: any) => {
    setFormData(prev => {
      const newData = { ...prev, [field]: value };
      if (field === 'selectedDate') {
        newData.selectedTime = '';
      }
      return newData;
    });
  };

  const toggleBodyArea = (area: string) => {
    setFormData(prev => {
      const current = prev.bodyArea;
      if (current.includes(area)) {
        return { ...prev, bodyArea: current.filter(a => a !== area) };
      } else {
        return { ...prev, bodyArea: [...current, area] };
      }
    });
  };

  const changeMonth = (offset: number) => {
    setViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() + offset, 1));
  };

  return {
    step, setStep, goToStep,
    formData, setFormData,
    viewDate, setViewDate,
    touchedContact, setTouchedContact,
    welcomeCustomer,
    uploadError, setUploadError,
    uploading, setUploading,
    submitting, setSubmitting,
    submitError, setSubmitError,
    timeSectionRef,
    referenceSectionRef,
    fileInputRef,
    config,
    configLoading,
    availLoading,
    styleOptions,
    dayAvailability,
    timeSlots,
    calendarDays,
    bookingUuid,
    resetToHome,
    updateField,
    toggleBodyArea,
    changeMonth,
    nextStep,
    prevStep,
    handleImageUpload,
    isStepValid,
    currentMonth,
    // New routing data
    stepOrder,
    currentStepIndex,
    totalSteps,
    // Turnstile
    turnstileContainerRef,
    turnstileToken,
    resetTurnstile,
  };
}

