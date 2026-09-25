import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { FormStep, INITIAL_FORM_DATA, TattooStyle } from '../types';
import type { FormData } from '../types';
import { normalizePhoneForForm, toE164Phone, isValidPhone, isValidEmail, isValidFullName, setStudioCountry } from '../utils/validation';
import { useBookingConfig, t } from './useBookingConfig';
import { useAvailability } from './useAvailability';
import { useLiveAvailability } from './useLiveAvailability';
import { savePendingImage, readPendingImage, clearPendingImage, previewUrl } from '../lib/pendingImage';
import { postBooking, SubmitError } from '../lib/submitRequest';
import { useTracking } from './useTracking';
import { useDataLayer } from './useDataLayer';
import { useTurnstile } from './useTurnstile';
import { api } from '../lib/env';
import { isBrowser, searchParams, currentHref, looksAutomated, readStorage, writeStorage, clearStorage } from '../lib/browser';
import { identifyInLiveChat } from '../lib/analytics';


export interface BookingFlowOptions {
  /** step taken from the URL, so refresh / back / forward all work */
  initialStep?: FormStep;
  /** called whenever the wizard moves, so the router can push a new URL */
  onStepChange?: (step: FormStep) => void;
}

export function useBookingFlow(locationSlug: string, locale: string, options: BookingFlowOptions = {}) {
  /* ── Surviving a backgrounded tab ──────────────────────────────────
   * The key below was only ever REMOVED — nothing wrote it — so the
   * answers lived in React state alone. A phone that discards the tab
   * while the visitor checks another app (routine on iOS after a couple
   * of minutes) brought them back to an empty form, several steps in.
   *
   * Dropped after a day so a shared or family device does not keep a
   * stranger's name and number around, and cleared outright on success. */
  const storageKey = `booking_session_${locationSlug}`;
  const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

  const restored = useMemo(() => {
    const raw = readStorage(storageKey);
    if (!raw) return null;
    try {
      const draft = JSON.parse(raw) as { at?: number; step?: number; formData?: Partial<FormData> };
      if (!draft.at || Date.now() - draft.at > DRAFT_TTL_MS) {
        clearStorage(storageKey);
        void clearPendingImage(pendingKey);
        return null;
      }
      return draft;
    } catch {
      clearStorage(storageKey);
      return null;
    }
  }, [storageKey]);

  const [step, setStep] = useState<FormStep>(
    /* An explicit step in the URL wins: a shared /b link or a page_form=1
       ad landing must go where it says, not where this visitor left off. */
    options.initialStep ?? (restored?.step as FormStep | undefined) ?? FormStep.WELCOME,
  );
  const [formData, setFormData] = useState<FormData>(
    restored?.formData ? { ...INITIAL_FORM_DATA, ...restored.formData } : INITIAL_FORM_DATA,
  );
  const [viewDate, setViewDate] = useState(new Date());
  const [touchedContact, setTouchedContact] = useState<{ fullName?: boolean; email?: boolean; phone?: boolean }>({});
  const [welcomeCustomer, setWelcomeCustomer] = useState<{ full_name: string; phone: string } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [bookingUuid, setBookingUuid] = useState<string | null>(null);

  /* Saved on every change rather than on navigation: the tab can be
     discarded at any moment, without a step ever being taken. The
     reference image is left out — it is a data URL and would blow the
     ~5 MB localStorage budget on its own. */
  useEffect(() => {
    if (step === FormStep.SUCCESS) return;
    const { referenceImage: _img, ...rest } = formData;
    void _img;
    writeStorage(storageKey, JSON.stringify({ at: Date.now(), step, formData: rest }));
  }, [formData, step, storageKey]);

  const timeSectionRef = useRef<HTMLDivElement>(null);
  const referenceSectionRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { config, loading: configLoading } = useBookingConfig(locationSlug, locale);
  const { turnstileToken, turnstileContainerRef, resetTurnstile, getSafeToken } = useTurnstile(config?.turnstileSiteKey);

  // Track physical user interaction trust (isTrusted)
  const isTrustedRef = useRef<boolean>(true);

  useEffect(() => {
    const handleInteraction = (e: Event) => {
      if (looksAutomated()) {
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
    if (looksAutomated()) return false;
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

  const { sessionUuid, leadId } = useTracking(locationSlug, step, trackingFormData, locale);
  const { trackStepView, trackStepComplete, trackSubmit, trackSuccess } = useDataLayer({
    name: config?.location.shortName ?? '',
    city: config?.location.gtmCity ?? '',
    country: config?.location.gtmCountry ?? 'United States',
  });

  const currentMonth = `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, '0')}`;

  const { data: availabilityData, loading: availLoading, refetch: refetchAvailability } = useAvailability(
    locationSlug, 
    currentMonth, 
    formData.timezone
  );

  /* Someone else taking a slot while this visitor is looking at it used to
     surface only on submit, as "That slot was just taken", after the whole
     form was filled in. */
  useLiveAvailability(config?.location.id ?? null, refetchAvailability);

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

    const params = searchParams();
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
        source_url: currentHref(),
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
      /* Retries a request that never got a real answer. Safe because the
         endpoint is idempotent per booking session — a second send returns
         the booking the first one made instead of taking another slot. */
      const resData = await postBooking(api('/api/booking/appointments'), payload);
      if (resData.booking_uuid) {
        setBookingUuid(resData.booking_uuid);
        // Booked: the draft has served its purpose and must not follow the
        // next person who opens this page on the same device.
        clearStorage(storageKey);
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
    } catch (err) {
      resetTurnstile();

      /* The old message blamed the customer's details for everything,
         including a dead connection. Say which of the three it was, so
         "try again" is advice and not a guess. Nothing is cleared: the
         answers stay on screen and in localStorage, ready to resend. */
      const fallback = (key: string, text: string) =>
        t(config?.translations, 'ui.messages', key, text);

      if (err instanceof SubmitError) {
        setSubmitError(
          err.kind === 'offline'
            ? fallback('no_connection', 'No internet connection. Your answers are saved — reconnect and try again.')
            : err.kind === 'unavailable'
              ? fallback('studio_unreachable', 'We could not reach the studio just now. Your answers are saved — please try again.')
              : err.message === 'too_many_attempts'
                ? fallback('too_many_attempts', 'Too many attempts. Please wait a moment and try again.')
                : err.message,
        );
      } else {
        setSubmitError(
          (err as Error).message ||
            fallback('submit_failed', 'Submission failed. Please check your information.'),
        );
      }
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

  /* ── Reference artwork ───────────────────────────────────────────
   * Uploaded only once the visitor is a lead — that is, once they have
   * handed over a phone or email and capture_lead() has run. Before that
   * the file is held in the browser: accepting uploads from anyone who
   * opens the page turns the studio's domain into free file hosting, and
   * the STORY step comes before CONTACT in the organic flow.
   *
   * Held in IndexedDB rather than in React state alone, so a tab the phone
   * discards does not cost the customer a second trip to their photo roll.
   */
  const pendingKey = `ref-image:${locationSlug}`;
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const uploadingRef = useRef(false);

  // Bring back whatever was picked before the tab went away.
  useEffect(() => {
    let revoked: string | null = null;
    void readPendingImage(pendingKey).then(file => {
      if (!file) return;
      setPendingImage(file);
      revoked = previewUrl(file);
      setPendingPreview(revoked);
    });
    return () => { if (revoked) URL.revokeObjectURL(revoked); };
  }, [pendingKey]);

  const putFile = useCallback(async (file: File): Promise<string | null> => {
    const fd = new FormData();
    fd.append('file', file);
    if (sessionUuid) fd.append('session_uuid', sessionUuid);

    const res = await fetch(api('/api/upload'), {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) throw new Error(data.message || 'Upload failed.');
    return data.url as string;
  }, [sessionUuid]);

  /* The moment a lead exists, flush whatever is waiting. */
  useEffect(() => {
    if (!leadId || !pendingImage || uploadingRef.current) return;
    uploadingRef.current = true;
    setUploading(true);

    void putFile(pendingImage)
      .then(url => {
        if (!url) return;
        setFormData(prev => ({ ...prev, referenceImage: url }));
        setPendingImage(null);
        if (pendingPreview) URL.revokeObjectURL(pendingPreview);
        setPendingPreview(null);
        void clearPendingImage(pendingKey);
      })
      .catch((err: Error) => setUploadError(err.message))
      .finally(() => { uploadingRef.current = false; setUploading(false); });
  }, [leadId, pendingImage, pendingPreview, pendingKey, putFile]);

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
    e.target.value = '';

    // Already identified: straight to the server, nothing to hold.
    if (leadId) {
      setUploading(true);
      try {
        const url = await putFile(file);
        if (url) setFormData(prev => ({ ...prev, referenceImage: url }));
      } catch (err) {
        setUploadError((err as Error).message);
      } finally {
        setUploading(false);
      }
      return;
    }

    // Anonymous so far: keep it here and show it from the local copy.
    if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    const preview = previewUrl(file);
    setPendingImage(file);
    setPendingPreview(preview);
    await savePendingImage(pendingKey, file);
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

  /* `any` here let a string land in a boolean field with no complaint. The
   generic ties the value to the field being written. */
  const updateField = <K extends keyof FormData>(field: K, value: FormData[K]) => {
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
    /** Local preview while the visitor is still anonymous. */
    pendingPreview,
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

