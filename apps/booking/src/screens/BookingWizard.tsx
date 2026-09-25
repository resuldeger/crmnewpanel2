import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FormStep } from '../types';
import { t } from '../hooks/useBookingConfig';
import { useBookingFlow } from '../hooks/useBookingFlow';
import { isValidPhone, isValidFullName, isValidEmail } from '../utils/validation';

import FormInput from '../components/FormInput';
import SelectionButton from '../components/SelectionButton';
import TimezoneSelect from '../components/TimezoneSelect';
import BodyMapZone from '../components/BodyMapZone';
import LoadingOverlay from '../components/LoadingOverlay';
import { PhoneInputField } from '../components/PhoneInputField';

import { SiteShell } from '../shell/SiteShell';
import { useLocaleCtx } from '../lib/locale';
import { bookingPath, stepFromSlug } from '../lib/steps';
import { openLiveChat } from '../lib/analytics';
import { ENV } from '../lib/env';

const PIERCING_ASSETS = {
  ear: '/images/ear_piercing_asset_1771713719103.png',
  face: '/images/face_piercing_asset_1771713732259.png',
  mouth: '/images/mouth_piercing_asset_1771713745291.png',
  body: '/images/body_piercing_asset_1771713758752.png',
  dermal: '/images/dermal_piercing_asset_1771713774747.png',
  genital: '/images/genital_piercing_asset_1771713789625.png',
};

const BookingWizard: React.FC = () => {
  const { slug = '', step: stepSlug, uuid: routeUuid } = useParams();
  const navigate = useNavigate();
  const { locale, setLocale, available, setAvailable } = useLocaleCtx();

  // The URL is the source of truth for which step is showing, so Back,
  // Forward and Refresh all behave the way a visitor expects.
  const routedStep = routeUuid ? FormStep.SUCCESS : stepFromSlug(stepSlug) ?? FormStep.WELCOME;

  const {
    step, setStep,
    formData,
    viewDate,
    touchedContact, setTouchedContact,
    welcomeCustomer,
    uploadError,
    uploading,
    submitting,
    submitError,
    timeSectionRef,
    referenceSectionRef,
    fileInputRef,
    config,
    configLoading,
    availLoading,
    styleOptions,
    timeSlots,
    calendarDays,
    bookingUuid,
    updateField,
    toggleBodyArea,
    changeMonth,
    nextStep,
    prevStep,
    handleImageUpload,
    isStepValid,
    currentMonth,
    stepOrder,
    currentStepIndex,
    totalSteps,
    turnstileContainerRef,
  } = useBookingFlow(slug, locale, {
    initialStep: routedStep,
    onStepChange: (next) => {
      if (next === FormStep.SUCCESS) return; // handled below, needs the uuid
      navigate(bookingPath(slug, next));
    },
  });


  // URL → state. Covers Back/Forward and someone pasting a step link.
  useEffect(() => {
    if (step !== routedStep) setStep(routedStep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routedStep]);

  // The confirmation lives at its own address so it survives a refresh and
  // can be shared. Previously it was unreachable state.
  useEffect(() => {
    if (step === FormStep.SUCCESS && bookingUuid && routeUuid !== bookingUuid) {
      navigate(`/${slug}/book/done/${bookingUuid}`, { replace: true });
    }
  }, [step, bookingUuid, routeUuid, slug, navigate]);

  // The language switcher offers exactly what the backend can serve.
  useEffect(() => {
    if (config?.supportedLocales?.length) setAvailable(config.supportedLocales);
  }, [config, setAvailable]);

  // A studio that is not taking bookings should not show a wizard.
  useEffect(() => {
    if (config && config.location.bookingActive === false) navigate("/", { replace: true });
  }, [config, navigate]);

  useEffect(() => {
    document.title = config?.location.name
      ? `Book an Appointment — ${config.location.name.replace(/^Cleopatra Ink\s+/, "")}`
      : "Book an Appointment — Cleopatra Ink";
  }, [config]);

  const styles = styleOptions; // For compatibility with existing JSX

  const atEdgeScreen = step === FormStep.WELCOME || step === FormStep.SUCCESS;

  return (
    <SiteShell
      locale={locale}
      availableLocales={available}
      onLocaleChange={setLocale}
      vignette={atEdgeScreen}
      chrome={step !== FormStep.SUCCESS}
    >
      <LoadingOverlay
        isVisible={configLoading || submitting}
        message={submitting ? t(config?.translations, 'ui.buttons', 'sending', 'Sending Request...') : undefined}
      />

      {step !== FormStep.WELCOME && step !== FormStep.SUCCESS && (
        <header className="relative z-50 p-4 md:p-8 flex flex-col items-center gap-4">
          
          <div className="flex flex-col items-center gap-1">
            <img 
              src={`${ENV.marketingBase}/img/cleopatra-logo.svg`} 
              alt="Cleopatra Ink" 
              className="h-12 md:h-16 w-auto object-contain filter drop-shadow-[0_0_10px_rgba(255,190,78,0.3)]" 
            />
            <span className="text-[8px] font-black tracking-[0.4em] text-[#FFBE4E] uppercase">
              {config?.location.shortName || '\u00a0'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 px-6">
            {Array.from({ length: totalSteps }, (_, i) => i + 1).map(i => (
              <div 
                key={i} 
                className={`h-1.5 rounded-full transition-all duration-700 ${
                  i < currentStepIndex
                    ? 'w-6 bg-[#FFBE4E]' 
                    : i === currentStepIndex
                      ? 'w-10 bg-[#FFBE4E] shadow-[0_0_10px_rgba(255,190,78,0.4)]' 
                      : 'w-6 bg-zinc-800'
                }`} 
              />
            ))}
          </div>
        </header>
      )}

      <main className={`relative z-10 flex-grow container mx-auto px-4 max-w-4xl flex flex-col ${step === FormStep.BODY_AREA ? 'justify-start' : 'justify-center'} ${step === FormStep.WELCOME || step === FormStep.SUCCESS ? 'pb-4' : 'pb-24'}`}>
        <div className="animate-reveal py-4">
          {step === FormStep.WELCOME && (
            <div className="text-center space-y-10 md:space-y-12">
              <div className="relative inline-block">
                <div className="absolute inset-0 bg-[#FFBE4E]/10 blur-[80px] rounded-full" />
                <div className="relative w-48 h-48 md:w-64 md:h-64 mx-auto mb-4">
                  <img src={`${ENV.marketingBase}/img/cleopatra-logo.svg`} alt="Cleopatra Ink" className="w-full h-full object-contain filter drop-shadow-[0_0_20px_rgba(255,190,78,0.4)]" />
                </div>
              </div>
              <div className="space-y-3">
                <h1 className="serif-font text-4xl md:text-6xl font-bold tracking-tight">
                  {(() => {
                    const rawTitle = t(config?.translations, 'welcome', 'title', 'Welcome to :location');
                    const locName = config?.location.shortName ?? config?.location.name ?? 'Cleopatra Ink';
                    return rawTitle.includes(':location') 
                      ? rawTitle.replace(':location', locName)
                      : `${rawTitle} ${locName}`;
                  })()}
                </h1>
                <p className="text-zinc-500 uppercase tracking-[0.3em] text-[10px] md:text-xs font-black">
                  {t(config?.translations, 'welcome', 'subtitle', 'The World’s Largest Tattoo Company')}
                </p>
                
                {welcomeCustomer && (
                  <div className="pt-8 space-y-6">
                    <div className="space-y-1.5">
                      <p className="text-zinc-500 uppercase tracking-[0.2em] text-[9px] font-black">
                        {t(config?.translations, 'welcome', 'customer_name', 'Your name')}
                      </p>
                      <p className="text-[#FFBE4E] font-bold text-xl md:text-2xl tracking-tight">{welcomeCustomer.full_name}</p>
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-zinc-500 uppercase tracking-[0.2em] text-[9px] font-black">
                         {t(config?.translations, 'welcome', 'customer_phone', 'Your number')}
                      </p>
                      <p className="text-zinc-400 text-sm md:text-base font-medium">{welcomeCustomer.phone}</p>
                    </div>
                  </div>
                )}
              </div>
              <div className="max-w-xs mx-auto space-y-6 pt-4">
                <button onClick={nextStep} className="w-full py-5 rounded-full bg-[#FFBE4E] text-black font-black uppercase tracking-[0.2em] text-xs md:hover:scale-[1.05] active:scale-95 transition-all shadow-2xl shadow-[#FFBE4E]/20">
                  {t(config?.translations, 'ui.buttons', 'start', 'Start My Tattoo Journey')}
                </button>
              </div>
            </div>
          )}

          {step === FormStep.PURPOSE && (
            <div className="space-y-8">
              <div className="text-center space-y-2">
                <h2 className="serif-font text-4xl md:text-6xl font-bold tracking-tight">
                    {t(config?.translations, 'step.purpose', 'title', 'What brings you in?')}
                </h2>
                <p className="text-zinc-500 uppercase tracking-[0.2em] text-[10px] font-bold">
                    {t(config?.translations, 'step.purpose', 'subtitle', 'SELECT THE PURPOSE OF YOUR VISIT.')}
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-1 gap-3 max-w-xl mx-auto">
                {config?.steps?.purpose?.map(opt => (
                  <SelectionButton 
                    key={opt.key}
                    label={opt.label} 
                    isSelected={formData.purpose === opt.key}
                    onClick={() => updateField('purpose', opt.key)}
                    description={opt.description ?? ''} 
                  />
                )) ?? (
                  <>
                    <SelectionButton 
                      label={t(config?.translations, 'step.purpose.options', 'first', 'NEW TATTOO')} 
                      isSelected={formData.purpose === 'first'}
                      onClick={() => updateField('purpose', 'first')}
                      description={t(config?.translations, 'step.purpose.options', 'first_desc', 'The beginning of your journey.')} 
                    />
                    <SelectionButton 
                      label={t(config?.translations, 'step.purpose.options', 'adding', 'TOUCH UP')} 
                      isSelected={formData.purpose === 'adding'} 
                      onClick={() => updateField('purpose', 'adding')}
                      description={t(config?.translations, 'step.purpose.options', 'adding_desc', 'Expanding your visual story.')} 
                    />
                    <SelectionButton 
                      label={t(config?.translations, 'step.purpose.options', 'cover', 'COVER UP')} 
                      isSelected={formData.purpose === 'cover'}
                      onClick={() => updateField('purpose', 'cover')}
                      description={t(config?.translations, 'step.purpose.options', 'cover_desc', 'A fresh start on existing ink.')} 
                    />
                    <SelectionButton 
                      label={t(config?.translations, 'step.purpose.options', 'explore', 'CONSULTATION ONLY')} 
                      isSelected={formData.purpose === 'explore'} 
                      onClick={() => updateField('purpose', 'explore')}
                      description={t(config?.translations, 'step.purpose.options', 'explore_desc', 'Find inspiration together.')} 
                    />
                    <SelectionButton 
                      label={t(config?.translations, 'step.purpose.options', 'piercing', 'PIERCING')} 
                      isSelected={formData.purpose === 'piercing'} 
                      onClick={() => updateField('purpose', 'piercing')}
                      description={t(config?.translations, 'step.purpose.options', 'piercing_desc', 'Body piercing consultation.')} 
                    />
                  </>
                )}
              </div>
            </div>
          )}

          {step === FormStep.STYLE && (
            <div className="space-y-10 md:space-y-12 max-w-2xl mx-auto">
              <div className="text-center space-y-4">
                <h2 className="serif-font text-4xl md:text-6xl font-bold tracking-tight">
                  {formData.purpose === 'piercing' 
                    ? t(config?.translations, 'step.style', 'piercing_title', 'Select a Category')
                    : t(config?.translations, 'step.style', 'title', 'Style')}
                </h2>
                <p className="text-zinc-500 uppercase tracking-[0.2em] text-[10px] md:text-xs font-bold">
                  {formData.purpose === 'piercing' 
                    ? t(config?.translations, 'step.style', 'piercing_subtitle', 'Which area would you like to get pierced?')
                    : t(config?.translations, 'step.style', 'subtitle', 'Choose your aesthetic')}
                </p>
              </div>

              {formData.purpose === 'piercing' ? (
                <div className="grid grid-cols-2 md:grid-cols-1 gap-3 max-w-xl mx-auto">
                  {(() => {
                    const piercingOpts = (config?.steps?.style ?? [])
                      .filter((opt: any) => ['ear', 'face', 'mouth', 'body', 'dermal', 'genital'].includes(opt.key.toLowerCase()));
                    
                    const optionsToRender = piercingOpts.length > 0 
                      ? piercingOpts 
                      : [
                          { key: 'ear', label: 'Ear' },
                          { key: 'face', label: 'Face' },
                          { key: 'mouth', label: 'Mouth' },
                          { key: 'body', label: 'Body' },
                          { key: 'dermal', label: 'Dermal' },
                          { key: 'genital', label: 'Genital' }
                        ];

                    return optionsToRender.map((opt: any) => (
                      <SelectionButton 
                        key={opt.key}
                        label={t(config?.translations, 'piercing.categories', opt.key.toLowerCase(), opt.label)} 
                        isSelected={formData.style === opt.key}
                        onClick={() => updateField('style', opt.key)}
                        image={PIERCING_ASSETS[opt.key as keyof typeof PIERCING_ASSETS] ?? ''}
                        showChevron
                      />
                    ));
                  })()}
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">

                  {styles.map((style) => (
                    <button
                      key={style.name}
                      onClick={() => updateField('style', style.name)}
                      className={`relative aspect-square rounded-xl overflow-hidden group border-2 transition-all duration-500 ${formData.style === style.name ? 'border-[#FFBE4E] scale-[1.02]' : 'border-zinc-900 bg-zinc-900/40 active:bg-zinc-800'}`}
                    >
                      <img src={style.img} className={`w-full h-full object-cover transition-all duration-700 opacity-60 ${formData.style === style.name ? 'grayscale-0 opacity-100' : 'grayscale-0 md:group-hover:grayscale-0 md:group-hover:opacity-100'}`} alt={style.label} />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end justify-center p-3">
                        <span className={`font-black text-center tracking-tighter text-[10px] md:text-xs uppercase italic drop-shadow-md transition-colors ${formData.style === style.name ? 'text-[#FFBE4E]' : 'text-white'}`}>
                          {style.label}
                        </span>
                      </div>
                      {formData.style === style.name && (
                        <div className="absolute top-2 right-2 w-5 h-5 bg-[#FFBE4E] rounded-full flex items-center justify-center text-black shadow-lg">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === FormStep.STORY && (
            <div className="space-y-10">
              <div className="text-center space-y-2">
                <h2 className="serif-font text-4xl md:text-6xl font-bold tracking-tight">
                   {t(config?.translations, 'step.story', 'title', 'Your Story')}
                </h2>
                <p className="text-zinc-500 uppercase tracking-[0.2em] text-[10px] font-bold">
                   {t(config?.translations, 'step.story', 'subtitle', 'How shall we design it?')}
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 max-w-3xl mx-auto">
                {config?.steps?.story?.map(opt => (
                  <button
                    key={opt.key}
                    onClick={() => {
                      updateField('storyType', opt.key);
                      setTimeout(() => {
                        referenceSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }, 150);
                    }}
                    className={`p-4 md:p-6 rounded-xl border-2 text-center transition-all duration-300 flex flex-col items-center gap-3 ${
                      formData.storyType === opt.key 
                        ? 'bg-[#FFBE4E] border-[#FFBE4E] text-black shadow-lg shadow-[#FFBE4E]/20 scale-[1.02]' 
                        : 'border-zinc-900 bg-zinc-900/40 hover:border-[#FFBE4E]/30'
                    }`}
                  >
                    <div className="text-3xl md:text-4xl">
                      {opt.key === 'have_reference' ? '🖼️' : (opt.key === 'have_idea' ? '✨' : '🎨')}
                    </div>
                    <div className="space-y-1">
                      <h3 className={`text-xs md:text-sm font-black uppercase tracking-widest ${formData.storyType === opt.key ? 'text-black' : 'text-white'}`}>
                        {opt.label}
                      </h3>
                      <p className={`text-[8px] md:text-[9px] uppercase tracking-wider font-bold ${formData.storyType === opt.key ? 'text-black/60' : 'text-zinc-500'}`}>
                        {opt.description}
                      </p>
                    </div>
                    {formData.storyType === opt.key && (
                      <div className="w-5 h-5 bg-black rounded-full flex items-center justify-center text-[#FFBE4E]">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      </div>
                    )}
                  </button>
                )) ?? (
                  <>
                    <button
                      onClick={() => {
                        updateField('storyType', 'have_reference');
                        setTimeout(() => referenceSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
                      }}
                      className={`p-6 rounded-xl border-2 text-center transition-all ${formData.storyType === 'have_reference' ? 'bg-[#FFBE4E] border-[#FFBE4E] text-black shadow-lg shadow-[#FFBE4E]/10' : 'border-zinc-900 bg-zinc-900/20'}`}
                    >
                      <div className="text-3xl mb-2">🖼️</div>
                      <h3 className="text-sm font-black uppercase tracking-widest mb-1">{t(config?.translations, 'step.story', 'have_reference', 'I have a reference')}</h3>
                      <p className={`text-[9px] uppercase tracking-wider ${formData.storyType === 'have_reference' ? 'text-black/60' : 'text-zinc-500'}`}>{t(config?.translations, 'step.story', 'upload_image', 'Upload an image')}</p>
                    </button>
                    <button
                      onClick={() => {
                        updateField('storyType', 'have_idea');
                        setTimeout(() => referenceSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
                      }}
                      className={`p-6 rounded-xl border-2 text-center transition-all ${formData.storyType === 'have_idea' ? 'bg-[#FFBE4E] border-[#FFBE4E] text-black shadow-lg shadow-[#FFBE4E]/10' : 'border-zinc-900 bg-zinc-900/20'}`}
                    >
                      <div className="text-3xl mb-2">✨</div>
                      <h3 className="text-sm font-black uppercase tracking-widest mb-1">{t(config?.translations, 'step.story', 'have_idea', 'Custom Design')}</h3>
                      <p className={`text-[9px] uppercase tracking-wider ${formData.storyType === 'have_idea' ? 'text-black/60' : 'text-zinc-500'}`}>{t(config?.translations, 'step.story', 'describe_scratch', 'Describe from scratch')}</p>
                    </button>
                  </>
                )}
              </div>

              {formData.storyType === 'have_reference' && (
                <div ref={referenceSectionRef} className="animate-reveal max-w-2xl mx-auto space-y-4 scroll-mt-20">
                  <div className="flex items-center gap-2 px-4">
                    <div className="h-px flex-grow bg-zinc-900" />
                    <span className="text-[9px] font-black uppercase tracking-[0.3em] text-[#FFBE4E]">{t(config?.translations, 'step.story', 'reference_image', 'Reference Image')}</span>
                    <div className="h-px flex-grow bg-zinc-900" />
                  </div>
                  {uploadError && (
                    <p className="text-[10px] text-red-400 text-center">{uploadError}</p>
                  )}
                  <div 
                    onClick={() => !uploading && fileInputRef.current?.click()}
                    className={`relative w-full aspect-[2/1] md:aspect-[3/1] rounded-2xl border-2 border-dashed transition-all duration-300 flex flex-col items-center justify-center group ${uploading ? 'cursor-wait border-zinc-800 opacity-70' : 'cursor-pointer'} ${formData.referenceImage ? 'border-[#FFBE4E]/50 bg-[#FFBE4E]/5' : 'border-zinc-800 bg-zinc-900/10 hover:border-[#FFBE4E]/40 hover:bg-[#FFBE4E]/5'}`}
                  >
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      className="hidden" 
                      accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif" 
                      onChange={handleImageUpload}
                      disabled={uploading}
                    />
                    
                    {uploading ? (
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-12 h-12 rounded-full border-2 border-[#FFBE4E]/40 border-t-[#FFBE4E] animate-spin" />
                        <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{t(config?.translations, 'step.story', 'uploading', 'Uploading...')}</p>
                      </div>
                    ) : formData.referenceImage ? (
                      <div className="absolute inset-0 p-2 md:p-4 flex items-center justify-center">
                        <div className="relative h-full w-full overflow-hidden rounded-xl group/preview">
                          <img src={formData.referenceImage} className="w-full h-full object-contain" alt="Reference Preview" />
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/preview:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                             <span className="text-[10px] font-black uppercase tracking-widest bg-[#FFBE4E] text-black px-3 py-1.5 rounded-full">{t(config?.translations, 'ui.buttons', 'change_image', 'Change Image')}</span>
                             <button 
                                onClick={(e) => { e.stopPropagation(); updateField('referenceImage', ''); }}
                                className="text-[9px] font-bold text-red-500 hover:text-red-400 transition-colors uppercase tracking-widest"
                             >
                               {t(config?.translations, 'ui.buttons', 'remove_image', 'Remove')}
                             </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-12 h-12 rounded-full bg-zinc-900 flex items-center justify-center group-hover:scale-110 group-hover:bg-[#FFBE4E]/20 transition-all">
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#FFBE4E]"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                        </div>
                        <div className="text-center">
                          <p className="text-[11px] font-black uppercase tracking-[0.15em] text-white">{t(config?.translations, 'step.story', 'upload_hint', 'Tap to upload your inspiration')}</p>
                          <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mt-1">{t(config?.translations, 'step.story', 'upload_types', 'PNG, JPG, GIF, WebP or HEIC (Max 10MB)')}</p>
                        </div>
                      </div>
                    )}
                  </div>
                  
                </div>
              )}

              {formData.storyType === 'have_idea' && (
                <div ref={referenceSectionRef} className="animate-reveal max-w-2xl mx-auto space-y-4 scroll-mt-20">
                  <div className="flex items-center gap-2 px-4">
                    <div className="h-px flex-grow bg-zinc-900" />
                    <span className="text-[9px] font-black uppercase tracking-[0.3em] text-[#FFBE4E]">
                      {t(config?.translations, 'step.story', 'idea_description', 'Your Idea')}
                    </span>
                    <div className="h-px flex-grow bg-zinc-900" />
                  </div>
                  <textarea
                    value={formData.storyDescription}
                    onChange={(e) => updateField('storyDescription', e.target.value)}
                    placeholder={t(config?.translations, 'step.story', 'idea_placeholder', 'Please describe your custom design idea in detail...')}
                    className="w-full bg-zinc-900/30 border-2 border-zinc-800 rounded-2xl p-4 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-[#FFBE4E]/50 transition-colors min-h-[120px] resize-y"
                  />
                  {!formData.storyDescription?.trim() && (
                    <p className="text-[10px] text-[#FFBE4E]/80 text-center font-bold uppercase tracking-widest">
                       {t(config?.translations, 'step.story', 'idea_required', 'Description is required to proceed')}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {step === FormStep.BODY_AREA && (
            <div className="space-y-4 animate-reveal pb-32 md:pb-28">
              <div className="text-center space-y-1">
                <h2 className="serif-font text-4xl md:text-6xl font-bold tracking-tight">
                  {t(config?.translations, 'step.body_area', 'title', 'Placement')}
                </h2>
                <p className="text-zinc-500 uppercase tracking-[0.2em] text-[10px] font-bold italic">
                  {t(config?.translations, 'step.body_area', 'subtitle', 'Tap to select all desired areas')}
                </p>
              </div>
              
              <div className="flex flex-row items-start justify-center max-w-4xl mx-auto gap-4 md:gap-8 pt-4">
                <div className="w-[40%] md:w-[35%] flex justify-center sticky top-4">
                  <div className="relative mt-20 md:mt-24 w-full flex justify-center">
                    {/* Tooltip */}
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 z-10 animate-pulse pointer-events-none w-max max-w-[140px] md:max-w-100 flex flex-col items-center">
                       <div className="bg-[#111] border border-zinc-700 text-zinc-300 text-[8px] md:text-[10px] uppercase tracking-widest px-3 py-2 md:px-4 md:py-3 rounded-xl flex items-start md:items-center gap-2 shadow-2xl leading-snug break-words whitespace-normal text-left">
                          <span className="w-1.5 h-1.5 bg-[#FFBE4E] rounded-full drop-shadow-[0_0_5px_rgba(255,190,78,0.8)] flex-shrink-0 mt-1 md:mt-0"></span>
                          <span>{t(config?.translations, 'step.body_area', 'tap_hint', 'Tap on any body part to select')}</span>
                       </div>
                       {/* Arrow indicator pointing to center of head */}
                       <div className="w-px h-6 md:h-10 bg-gradient-to-b from-[#FFBE4E]/60 to-transparent"></div>
                    </div>
                    <div className="absolute inset-0 bg-[#FFBE4E]/5 blur-[60px] rounded-full -z-10" />
                    <svg width="180" height="360" viewBox="0 0 100 200" className="filter drop-shadow-[0_0_20px_rgba(255,190,78,0.05)]">
                      <BodyMapZone label={t(config?.translations, 'body.areas', 'face', 'Face')} id="face" path="M50,8 c-6,0 -11,6 -11,13 s5,13 11,13 s11,-6 11,-13 s-5,-13 -11,-13" selected={formData.bodyArea.includes('face')} onToggle={toggleBodyArea} />
                      <BodyMapZone label={t(config?.translations, 'body.areas', 'neck', 'Neck')} id="neck" path="M41,33 l18,0 l2,6 l-22,0 z" selected={formData.bodyArea.includes('neck')} onToggle={toggleBodyArea} />
                      <BodyMapZone label={t(config?.translations, 'body.areas', 'chest', 'Chest')} id="chest" path="M32,40 c0,0 18,-4 36,0 l6,10 l-4,25 l-40,0 l-4,-25 z" selected={formData.bodyArea.includes('chest')} onToggle={toggleBodyArea} />
                      <BodyMapZone label={t(config?.translations, 'body.areas', 'stomach', 'Stomach')} id="stomach" path="M34,75 l32,0 l-2,20 l-28,0 z" selected={formData.bodyArea.includes('stomach')} onToggle={toggleBodyArea} />
                      <BodyMapZone label={t(config?.translations, 'body.areas', 'shoulder', 'Shoulder')} id="shoulder" path="M32,40 l-8,4 l-3,10 l11,-4 z M68,40 l8,4 l3,10 l-11,-4 z" selected={formData.bodyArea.includes('shoulder')} onToggle={toggleBodyArea} />
                      <BodyMapZone label={t(config?.translations, 'body.areas', 'arm', 'Arm')} id="arm" path="M21,54 l-6,40 l5,4 l6,-40 z M79,54 l6,40 l-5,4 l-6,-40 z" selected={formData.bodyArea.includes('arm')} onToggle={toggleBodyArea} />
                      <BodyMapZone label={t(config?.translations, 'body.areas', 'forearm', 'Forearm')} id="forearm" path="M15,98 l-4,35 l6,4 l4,-35 z M85,98 l4,35 l-6,4 l-4,-35 z" selected={formData.bodyArea.includes('forearm')} onToggle={toggleBodyArea} />
                      <BodyMapZone label={t(config?.translations, 'body.areas', 'hand', 'Hand')} id="hand" path="M10,135 l-2,10 l5,5 l3,-10 z M90,135 l2,10 l-5,5 l-3,-10 z" selected={formData.bodyArea.includes('hand')} onToggle={toggleBodyArea} />
                      <BodyMapZone label={t(config?.translations, 'body.areas', 'hip', 'Hip')} id="hip" path="M34,95 l32,0 l2,15 l-36,0 z" selected={formData.bodyArea.includes('hip')} onToggle={toggleBodyArea} />
                      <BodyMapZone label={t(config?.translations, 'body.areas', 'thigh', 'Thigh')} id="thigh" path="M32,110 l16,0 l-2,40 l-14,0 z M52,110 l16,0 l-2,40 l-14,0 z" selected={formData.bodyArea.includes('thigh')} onToggle={toggleBodyArea} />
                      <BodyMapZone label={t(config?.translations, 'body.areas', 'leg', 'Shin / Calf')} id="leg" path="M34,152 l12,0 l-1,35 l-10,0 z M54,152 l12,0 l-1,35 l-10,0 z" selected={formData.bodyArea.includes('leg')} onToggle={toggleBodyArea} />
                      <BodyMapZone label={t(config?.translations, 'body.areas', 'foot', 'Foot')} id="foot" path="M33,189 l10,0 l3,6 l-12,0 z M54,189 l10,0 l3,6 l-12,0 z" selected={formData.bodyArea.includes('foot')} onToggle={toggleBodyArea} />
                    </svg>
                  </div>
                </div>

                <div className="w-[60%] md:w-[65%] flex flex-col gap-4 self-stretch pt-2">
                  <div className="flex flex-col flex-grow bg-zinc-900/30 backdrop-blur-md border border-zinc-800 rounded-2xl p-4 md:p-6 overflow-hidden">
                    <div className="flex items-center justify-between mb-4 border-b border-zinc-800/50 pb-2">
                      <span className="text-[9px] font-black uppercase tracking-[0.3em] text-[#FFBE4E]">{t(config?.translations, 'ui.labels', 'selected_areas', 'Selected Areas')}</span>
                      <span className="bg-zinc-800 text-zinc-400 text-[10px] px-2 py-0.5 rounded-full font-bold">{formData.bodyArea.length}</span>
                    </div>

                    <div className="flex flex-wrap gap-2 overflow-y-auto max-h-[280px] md:max-h-[400px] scrollbar-hide pr-1">
                      {formData.bodyArea.length > 0 ? (
                        formData.bodyArea.map((area) => (
                          <div 
                            key={area}
                            className="bg-[#FFBE4E]/10 border border-[#FFBE4E]/30 text-[#FFBE4E] px-3 py-2 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-widest flex items-center gap-2 animate-reveal"
                          >
                            {t(config?.translations, 'body.areas', area.toLowerCase(), area)}
                            <button onClick={() => toggleBodyArea(area)} className="hover:text-white transition-colors">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                            </button>
                          </div>
                        ))
                      ) : (
                        <div className="h-full flex flex-col items-center justify-center text-center opacity-30 py-8 w-[100%] h-[100%]">
                          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="mb-2"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>
                          <p className="text-[10px] uppercase tracking-widest leading-relaxed whitespace-pre-line">{t(config?.translations, 'step.body_area', 'hint', "Touch the silhouette\nto add placement")}</p>
                        </div>
                      )}
                    </div>

                    {formData.bodyArea.length > 0 && (
                      <button 
                        onClick={() => updateField('bodyArea', [])}
                        className="mt-auto pt-4 text-[9px] font-black uppercase tracking-widest text-zinc-600 hover:text-red-500 transition-colors flex items-center gap-1"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        {t(config?.translations, 'ui.buttons', 'clear_selection', 'Clear Selection')}
                      </button>
                    )}
                  </div>

                  <div className="p-4 bg-zinc-950/50 border border-zinc-900 rounded-xl">
                    <button 
                      onClick={() => toggleBodyArea('special_request')}
                      className={`w-full text-[9px] font-black uppercase tracking-[0.2em] transition-all py-3 px-4 rounded-lg border flex items-center justify-between ${formData.bodyArea.includes('special_request') ? 'border-[#FFBE4E] bg-[#FFBE4E] text-black' : 'border-zinc-800 text-zinc-500 hover:text-white'}`}
                    >
                      {t(config?.translations, 'step.body_area', 'special_request', 'Other / Multiple Area Request')}
                      <span>{formData.bodyArea.includes('special_request') ? '✓' : '+'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === FormStep.SIZE && (
            <div className="space-y-8">
              <div className="text-center space-y-2">
                <h2 className="serif-font text-4xl md:text-6xl font-bold tracking-tight">
                  {t(config?.translations, 'step.size', 'title', 'Dimensions')}
                </h2>
                <p className="text-zinc-500 uppercase tracking-[0.2em] text-[10px] font-bold">
                  {t(config?.translations, 'step.size', 'subtitle', 'Scale of your project')}
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-1 gap-3 max-w-xl mx-auto">
                {(config?.steps?.size ?? []).map((opt: any) => (
                  <SelectionButton 
                    key={opt.key}
                    label={opt.label} 
                    isSelected={formData.size === opt.key}
                    onClick={() => updateField('size', opt.key)}
                    description={opt.description ?? ''} 
                  />
                ))}
              </div>
            </div>
          )}

          {step === FormStep.TIMING && (
            <div className="space-y-4 max-w-lg mx-auto pb-10">
              <div className="text-center space-y-2 mb-6">
                <h2 className="serif-font text-4xl md:text-6xl font-bold tracking-tight">
                  {t(config?.translations, 'step.calendar', 'title', 'Pick a Date & Time')}
                </h2>
                <p className="text-zinc-500 uppercase tracking-[0.2em] text-[10px] font-bold italic">
                  {t(config?.translations, 'step.calendar', 'subtitle', 'When shall we begin?')}
                </p>
              </div>
              
              <div className="space-y-3 bg-zinc-900/20 p-2 md:p-3 rounded-2xl border border-zinc-800 backdrop-blur-sm max-w-[320px] mx-auto shadow-2xl">
                <div className="flex items-center justify-between px-1">
                  <h3 className="serif-font text-sm md:text-base font-bold tracking-tight text-[#FFBE4E]">
                    {viewDate.toLocaleString(locale, { month: 'long', year: 'numeric' })}
                  </h3>
                  <div className="flex gap-1">
                    <button 
                      onClick={() => changeMonth(-1)} 
                      className="w-6 h-6 rounded-full border border-zinc-800 flex items-center justify-center hover:bg-zinc-800 transition-colors"
                      disabled={viewDate.getMonth() === new Date().getMonth() && viewDate.getFullYear() === new Date().getFullYear()}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m15 18-6-6 6-6"/></svg>
                    </button>
                    <button 
                      onClick={() => changeMonth(1)} 
                      className="w-6 h-6 rounded-full border border-zinc-800 flex items-center justify-center hover:bg-zinc-900 transition-colors"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 18 6-6-6-6"/></svg>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-7 gap-px text-center">
                  {[
                    t(config?.translations, 'calendar.days', 'mo', 'MO'),
                    t(config?.translations, 'calendar.days', 'tu', 'TU'),
                    t(config?.translations, 'calendar.days', 'we', 'WE'),
                    t(config?.translations, 'calendar.days', 'th', 'TH'),
                    t(config?.translations, 'calendar.days', 'fr', 'FR'),
                    t(config?.translations, 'calendar.days', 'sa', 'SA'),
                    t(config?.translations, 'calendar.days', 'su', 'SU')
                  ].map(day => (
                    <div key={day} className="text-[8px] font-black text-zinc-700 tracking-[0.1em] py-1">{day}</div>
                  ))}
                  {calendarDays.map((date, i) => {
                    if (!date) return <div key={i} className="aspect-square" />;
                    const y = date.getFullYear();
                    const m = String(date.getMonth() + 1).padStart(2, '0');
                    const d = String(date.getDate()).padStart(2, '0');
                    const dateStr = `${y}-${m}-${d}`;
                    
                    const isSelected = formData.selectedDate === dateStr;
                    const todayDate = new Date();
                    todayDate.setHours(0,0,0,0);
                    const isToday = date.toDateString() === todayDate.toDateString();
                    const isPast = date < todayDate;
                    
                    const maxDate = new Date(todayDate);
                    maxDate.setDate(maxDate.getDate() + 14);
                    const isBeyond14Days = date > maxDate;
                    const isDisabled = isPast || isBeyond14Days;

                    return (
                      <div key={i} className={`relative group/day ${isDisabled ? 'cursor-not-allowed' : ''}`}>
                        <button 
                          type="button"
                          aria-disabled={isDisabled}
                          onClick={() => {
                            if (isDisabled) return;
                            updateField('selectedDate', dateStr);
                            setTimeout(() => {
                              timeSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }, 150);
                          }} 
                          className={`w-full aspect-square flex items-center justify-center rounded-sm text-[9px] font-bold transition-all duration-300 border ${
                            isSelected 
                              ? 'bg-[#FFBE4E] border-[#FFBE4E] text-black shadow-md shadow-[#FFBE4E]/20 scale-[1.03] z-10' 
                              : isDisabled 
                                ? 'text-zinc-800 border-transparent pointer-events-none group-hover/day:pointer-events-auto'
                                : 'text-zinc-500 border-transparent hover:border-zinc-800 hover:bg-zinc-900/50 hover:text-white'
                          }`}
                        >
                          {date.getDate()}
                          {isToday && !isSelected && <div className="absolute bottom-0.5 w-0.5 h-0.5 bg-[#FFBE4E] rounded-full" />}
                        </button>
                        {isBeyond14Days && (
                          <div className="absolute opacity-0 group-hover/day:opacity-100 transition-opacity z-50 pointer-events-none bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 w-48 bg-zinc-900 border border-zinc-700 p-3 rounded-lg shadow-xl shrink-0">
                            <p className="text-[10px] text-zinc-300 leading-snug break-words whitespace-normal text-left">
                              <span className="text-white font-bold">{t(config?.translations, 'ui.messages', 'unavailable', 'Unavailable')}</span> - {t(config?.translations, 'step.calendar', 'max_14_days', 'Please select a date within 14 days from today.')}
                            </p>
                            <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-zinc-900 border-b border-r border-zinc-700 rotate-45" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              
              <div className="text-center px-4 max-w-[320px] mx-auto mt-6">
                <h4 className="text-[#FFBE4E] text-xs font-serif font-bold tracking-wide mb-1">
                  {t(config?.translations, 'step.calendar', 'max_14_days_title', 'Consultations can be booked up to 14 days from today.')}
                </h4>
                <p className="text-zinc-500 text-[10px] leading-relaxed">
                  {t(config?.translations, 'step.calendar', 'max_14_days_desc', "Your first visit is a free custom design session. We'll review your request together, create your concept, and get everything ready before any ink is applied.")}
                </p>
              </div>

              <div ref={timeSectionRef} className="animate-reveal space-y-4 pt-6 max-w-[340px] mx-auto scroll-mt-24">
                  <div className="flex items-center gap-2 px-4">
                    <div className="h-px flex-grow bg-zinc-900" />
                    <h3 className="text-[9px] font-black uppercase tracking-[0.3em] text-[#FFBE4E]">
                      {t(config?.translations, 'ui.labels', 'preferred_time', 'Preferred Time')}
                    </h3>
                    <div className="h-px flex-grow bg-zinc-900" />
                  </div>
                  <div className="space-y-6">
                    <TimezoneSelect 
                      value={formData.timezone} 
                      onChange={(tz) => updateField('timezone', tz)} 
                      translations={config?.translations}
                    />

                    <div className="flex items-center gap-4">
                      <div className="h-px flex-grow bg-zinc-900" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-zinc-700">
                        {t(config?.translations, 'ui.labels', 'available_times', 'Available Times')}
                        {!formData.selectedTime && formData.selectedDate && (
                          <span className="text-[#FFBE4E] ml-2 font-medium capitalize">
                            - {t(config?.translations, 'ui.messages', 'please_select', 'Please select')}
                          </span>
                        )}
                      </span>
                      <div className="h-px flex-grow bg-zinc-900" />
                    </div>
                    
                    {formData.selectedDate === `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}` && (
                      <p className="text-[10px] text-center text-zinc-500 italic mt-1 uppercase tracking-wider font-bold">
                        {t(config?.translations, 'step.calendar', 'same_day_notice', '* Appointments for today must be booked at least 2 hours in advance.')}
                      </p>
                    )}

                    <div className="grid grid-cols-2 gap-3 px-1">
                    {availLoading ? (
                      <div className="col-span-2 py-10 text-center animate-pulse">
                        <div className="text-[10px] font-black uppercase tracking-widest text-zinc-700">{t(config?.translations, 'ui.messages', 'checking_availability', 'Checking availability...')}</div>
                      </div>
                    ) : !formData.selectedDate || (formData.selectedDate && !formData.selectedDate.startsWith(currentMonth)) ? (
                      <div className="col-span-2 py-10 text-center bg-zinc-950/10 border-2 border-dashed border-zinc-900/50 rounded-2xl group/hint hover:border-[#FFBE4E]/30 transition-colors">
                        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600 group-hover/hint:text-zinc-400 transition-colors">
                          {t(config?.translations, 'step.calendar', 'select_date_hint', 'Please select a date from the calendar')}
                        </p>
                      </div>
                    ) : timeSlots.length > 0 ? (
                      timeSlots.map(slot => (
                        <button 
                          key={slot.time} 
                          disabled={slot.booked}
                          onClick={() => updateField('selectedTime', slot.time)} 
                          className={`py-5 rounded-xl border-2 font-black tracking-tight text-xs transition-all duration-300 relative overflow-hidden group/slot ${
                            slot.booked
                              ? 'bg-zinc-950/30 border-zinc-900 text-zinc-500 cursor-not-allowed'
                              : formData.selectedTime === slot.time 
                                ? 'bg-[#FFBE4E] border-[#FFBE4E] text-black shadow-lg shadow-[#FFBE4E]/20 scale-[1.02]' 
                                : 'bg-zinc-950/30 border-zinc-900 text-zinc-500 hover:border-zinc-700 hover:text-white'
                          }`}
                        >
                          <span className="">{slot.time}</span>
                          {slot.booked && (
                            <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/20 backdrop-blur-[0.5px]">
                               <div className="absolute w-[80%] h-[1px] bg-zinc-800 rotate-45 opacity-90" />
                               <div className="absolute w-[80%] h-[1px] bg-zinc-800 -rotate-45 opacity-90" />
                            </div>
                          )}
                          {!slot.booked && formData.selectedTime === slot.time && (
                             <div className="absolute right-2 top-2 w-1.5 h-1.5 bg-black rounded-full animate-pulse" />
                          )}
                        </button>
                      ))
                    ) : (
                      <div className="col-span-2 py-10 text-center bg-zinc-950/20 border-2 border-dashed border-zinc-900 rounded-2xl">
                        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600">
                          {t(config?.translations, 'step.calendar', 'no_slots', 'No slots available for this day')}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
          </div>
        )}

          {step === FormStep.CONTACT && (
            <div className="space-y-8">
              <div className="text-center space-y-2">
                <h2 className="serif-font text-4xl md:text-6xl font-bold tracking-tight">{t(config?.translations, 'step.contact', 'title', 'Contact')}</h2>
                <p className="text-zinc-500 uppercase tracking-[0.2em] text-[10px] font-bold">{t(config?.translations, 'step.contact', 'subtitle', 'Secure your session')}</p>
              </div>
              <form className="max-w-md mx-auto space-y-5" onSubmit={(e) => e.preventDefault()}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormInput
                    label={t(config?.translations, 'ui.labels', 'full_name', 'Full Name')}
                    autoComplete="name"
                    value={formData.fullName}
                    onChange={val => updateField('fullName', val)}
                    onBlur={() => setTouchedContact(prev => ({ ...prev, fullName: true }))}
                    error={touchedContact.fullName && !isValidFullName(formData.fullName) ? t(config?.translations, 'ui.validation', 'name_short', 'Name too short') : undefined}
                    icon={<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>}
                    placeholder={t(config?.translations, 'ui.placeholders', 'name', 'John Doe')}
                  />

                  <FormInput
                    label={t(config?.translations, 'ui.labels', 'email', 'Email Address')}
                    type="email"
                    autoComplete="email"
                    value={formData.email}
                    onChange={val => updateField('email', val)}
                    onBlur={() => setTouchedContact(prev => ({ ...prev, email: true }))}
                    error={touchedContact.email && !isValidEmail(formData.email) ? t(config?.translations, 'ui.validation', 'invalid_email', 'Invalid email') : undefined}
                    icon={<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>}
                    placeholder={t(config?.translations, 'ui.placeholders', 'email', 'john@example.com')}
                  />
                </div>

                <PhoneInputField
                  label={t(config?.translations, 'ui.labels', 'phone', 'Phone Number')}
                  value={formData.phone}
                  onChange={val => updateField('phone', val)}
                  onBlur={() => setTouchedContact(prev => ({ ...prev, phone: true }))}
                  placeholder={t(config?.translations, 'ui.placeholders', 'phone', '5XX XXX XX XX')}
                  error={touchedContact.phone && !isValidPhone(formData.phone) ? t(config?.translations, 'ui.validation', 'invalid_phone', 'Invalid phone number') : undefined}
                  translations={config?.translations}
                />

                <div className="pt-2">
                  <label className="flex gap-4 p-4 rounded-2xl border-2 border-zinc-900 bg-zinc-900/10 cursor-pointer group hover:border-[#FFBE4E]/30 transition-all duration-300">
                    <div className="relative flex items-center">
                      <input 
                        type="checkbox" 
                        className="peer w-6 h-6 border-2 border-zinc-800 bg-black rounded-lg appearance-none checked:bg-[#FFBE4E] checked:border-[#FFBE4E] transition-all cursor-pointer" 
                        checked={formData.smsConsent} 
                        onChange={e => updateField('smsConsent', e.target.checked)} 
                      />
                      <svg className="absolute w-4 h-4 text-black font-bold hidden peer-checked:block pointer-events-none left-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    </div>
                    <span className="text-[10px] text-zinc-500 group-hover:text-zinc-400 leading-snug transition-colors">
                      {t(config?.translations, 'ui.contact', 'sms_agree', `I agree to receive SMS notifications from ${config?.location.name ?? 'Cleopatra Ink'}.`)}
                    </span>
                  </label>
                </div>

                <div className="pt-2 flex justify-center">
                  <div ref={turnstileContainerRef} className="min-h-[65px] flex items-center justify-center" />
                </div>

                {submitError && (
                  <p className="text-[11px] font-bold text-red-500 text-center mt-6 bg-red-500/5 p-4 rounded-xl border border-red-500/20 uppercase tracking-tight">
                    {submitError}
                  </p>
                )}
              </form>

            </div>
          )}

          {step === FormStep.ADDRESS && (
            <div className="space-y-8 animate-reveal">
              <div className="text-center space-y-2">
                <h2 className="serif-font text-4xl md:text-6xl font-bold tracking-tight">
                  {t(config?.translations, 'step.address', 'title', 'VIP Pickup')}
                </h2>
                <p className="text-zinc-500 uppercase tracking-[0.2em] text-[10px] font-bold">
                  {t(config?.translations, 'step.address', 'subtitle', 'Complimentary studio transport service')}
                </p>
              </div>
              
              <div className="max-w-md mx-auto space-y-6">
                <div className="pt-2">
                  <label className="flex gap-4 p-5 rounded-2xl border-2 border-[#FFBE4E]/20 bg-[#FFBE4E]/5 cursor-pointer group hover:border-[#FFBE4E]/50 transition-all duration-300">
                    <div className="relative flex items-center">
                      <input 
                        type="checkbox" 
                        className="peer w-6 h-6 border-2 border-zinc-800 bg-black rounded-lg appearance-none checked:bg-[#FFBE4E] checked:border-[#FFBE4E] transition-all cursor-pointer" 
                        checked={formData.isFreePick} 
                        onChange={e => updateField('isFreePick', e.target.checked)} 
                      />
                      <svg className="absolute w-4 h-4 text-black font-bold hidden peer-checked:block pointer-events-none left-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-black uppercase tracking-widest text-[#FFBE4E]">
                        {t(config?.translations, 'step.address', 'free_pick_optin', 'Yes, I want the VIP Pickup Service')}
                      </span>
                      <span className="text-[10px] text-zinc-500 group-hover:text-zinc-400 leading-snug transition-colors">
                        {t(config?.translations, 'step.address', 'free_pick_desc', 'Get a complimentary ride to your appointment.')}
                      </span>
                    </div>
                  </label>
                </div>

                <div className="min-h-[200px] transition-all duration-500 ease-in-out">
                  {formData.isFreePick ? (
                    <div className="space-y-4 animate-reveal">
                      <FormInput
                        label={t(config?.translations, 'step.address', 'address_street', 'Pickup Address')}
                        value={formData.addressStreet}
                        onChange={val => updateField('addressStreet', val)}
                        placeholder="123 Ocean Drive"
                        icon={<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>}
                      />
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormInput
                          label={t(config?.translations, 'step.address', 'address_city', 'City')}
                          value={formData.addressCity}
                          onChange={val => updateField('addressCity', val)}
                          placeholder="Miami"
                        />
                        <div className="grid grid-cols-2 gap-4">
                          <FormInput
                            label={t(config?.translations, 'step.address', 'address_state', 'State')}
                            value={formData.addressState}
                            onChange={val => updateField('addressState', val)}
                            placeholder="FL"
                          />
                          <FormInput
                            label={t(config?.translations, 'step.address', 'address_zip', 'ZIP Code')}
                            value={formData.addressZip}
                            onChange={val => updateField('addressZip', val)}
                            placeholder="33139"
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-8 rounded-2xl border-2 border-dashed border-zinc-900/50 text-center opacity-40">
                       <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                         {t(config?.translations, 'step.address', 'skip_notice', 'You can skip this step if you don’t need a ride.')}
                       </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          
          {step === FormStep.SUCCESS && (
            <div className="text-center space-y-10 py-8 animate-reveal">
              <div className="relative inline-block">
                <div className="absolute inset-0 bg-[#FFBE4E]/20 blur-[60px] rounded-full animate-pulse" />
                <div className="relative w-48 h-48 md:w-64 md:h-64 mx-auto mb-4 flex items-center justify-center">
                  <img src={`${ENV.marketingBase}/img/cleopatra-logo.svg`} alt="Cleopatra Ink" className="w-full h-full object-contain filter drop-shadow-[0_0_30px_rgba(255,190,78,0.5)]" />
                </div>
              </div>
              
              <div className="space-y-4 max-w-lg mx-auto">
                <h2 className="serif-font text-5xl md:text-7xl font-bold tracking-tight text-[#FFBE4E]">
                  {t(config?.translations, 'ui.messages', 'success_title', 'Thank You')}
                </h2>

                <p className="text-xl text-zinc-400 font-light tracking-wide">
                  {t(config?.translations, 'ui.messages', 'success_subtitle', 'Your appointment is confirmed!')}
                </p>

                <p className="text-sm md:text-base text-zinc-500 max-w-md mx-auto leading-relaxed">
                  {t(config?.translations, 'ui.messages', 'success_welcome', 'We’re excited to welcome you to our studio and can’t wait to bring your vision to life.')}
                </p>

                <p className="text-sm md:text-base text-zinc-500 max-w-md mx-auto leading-relaxed">
                  {t(config?.translations, 'ui.messages', 'success_welcome_info', 'Just a heads up, your first visit is a free design consultation. No ink yet. Bring any reference images or ideas you have so our artist can start building your custom concept.')}
                </p>

              </div>

              <div className="pt-6 max-w-sm mx-auto space-y-4">
                {bookingUuid && (
                  <a 
                    href={`${ENV.apiBase}/api/booking/appointments/${bookingUuid}/ics`}
                    download="appointment.ics"
                    className="flex items-center justify-center gap-2 w-full py-4 rounded-full bg-[#FFBE4E] text-black font-black uppercase tracking-[0.15em] text-[10px] md:text-xs hover:scale-[1.02] transition-all duration-300 shadow-xl shadow-[#FFBE4E]/20"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/></svg>
                    {t(config?.translations, 'ui.buttons', 'add_to_calendar', 'Add to Calendar')}
                  </a>
                )}

                {bookingUuid && (
                  <a 
                    href={`/b/${bookingUuid}`}
                    className="flex items-center justify-center gap-2 w-full py-4 rounded-full border border-[#FFBE4E] text-[#FFBE4E] font-black uppercase tracking-[0.15em] text-[10px] md:text-xs hover:bg-[#FFBE4E] hover:text-black transition-all duration-300"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    {t(config?.translations, 'ui.buttons', 'manage_booking', 'Manage Appointment')}
                  </a>
                )}

                {config?.location.mapLink && (
                  <a 
                    href={config.location.mapLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full py-4 rounded-full border border-zinc-700 bg-zinc-900/50 text-white font-bold uppercase tracking-[0.1em] text-[10px] md:text-xs hover:bg-zinc-800 transition-colors duration-300"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                    {t(config?.translations, 'ui.buttons', 'view_on_map', 'View on Map')}
                  </a>
                )}

                <button 
                  onClick={openLiveChat}
                  className="flex items-center justify-center gap-2 w-full py-4 rounded-full border-2 border-zinc-800 text-zinc-300 font-black uppercase tracking-[0.2em] text-[10px] md:text-xs hover:border-[#FFBE4E] hover:text-[#FFBE4E] transition-all duration-300"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  {t(config?.translations, 'ui.buttons', 'chat_with_us', 'Chat with Us')}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {step !== FormStep.SUCCESS && step !== FormStep.WELCOME && (
        <footer className="fixed bottom-0 left-0 right-0 z-50 p-4 md:p-10 bg-gradient-to-t from-black via-black/90 to-transparent">
          <div className="container mx-auto flex flex-col gap-2 max-w-xl">
            {submitError && (
              <div className="text-[11px] font-bold text-red-400 text-center bg-red-500/10 p-3 rounded-xl border border-red-500/30 uppercase tracking-tight animate-reveal">
                {submitError}
              </div>
            )}
            <div className="flex gap-3 w-full">
              {currentStepIndex > 1 && (
                <button onClick={prevStep} className="h-14 w-14 rounded-full border-2 border-zinc-800 bg-black/50 flex items-center justify-center hover:bg-zinc-900 transition-colors">
                  <span className="text-lg text-zinc-500">←</span>
                </button>
              )}
              <button 
                onClick={nextStep} 
                disabled={!isStepValid() || submitting} 
                className={`flex-grow h-14 rounded-full font-black uppercase tracking-[0.1em] text-[10px] md:text-xs transition-all flex items-center justify-center gap-2 ${isStepValid() && !submitting ? 'bg-[#FFBE4E] text-black hover:scale-[1.02] shadow-xl shadow-[#FFBE4E]/10' : 'bg-zinc-900 text-zinc-600 cursor-not-allowed border-2 border-zinc-800'}`}
              >
                {(() => {
                  if (submitting) return t(config?.translations, 'ui.buttons', 'sending', 'Sending Request...');
                  const label = stepOrder[currentStepIndex + 1] === FormStep.SUCCESS
                    ? t(config?.translations, 'ui.buttons', 'submit', 'Finalize My Booking')
                    : t(config?.translations, 'ui.buttons', 'next', 'Next Step');
                  // Several dictionary entries already end in an arrow
                  // ("Next Step →", "Sonraki Adım →"), so appending another
                  // rendered "SONRAKI ADIM → →".
                  const hasArrow = /[→›»]\s*$/.test(label);
                  return (
                    <>
                      {label}
                      {!hasArrow && <span className="text-base md:text-lg">→</span>}
                    </>
                  );
                })()}
              </button>
            </div>
          </div>
        </footer>
      )}

    </SiteShell>
  );
};

export default BookingWizard;
