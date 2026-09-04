  const profilesEqual = (left, right) => Boolean(left && right
    && left.id === right.id && left.path === right.path && left.hash === right.hash);

  const configuredDefaultProfile = () => cloneProfile(
    allProfiles().find((profile) => profile.id === state.config.defaultProfileId)
      ?? DEFAULT_PROFILE,
  );

  const selectPendingProfile = (profile) => {
    state.profileSelectionVersion += 1;
    persistPendingProfile(profile);
  };

  const claimPendingProfileForTask = (params) => {
    const profile = resolvePendingProfile();
    const fallback = configuredDefaultProfile();
    const eligible = featureEnabled("prompt") && isEligibleThreadStart(params);
    if (eligible) state.profileSelectionVersion += 1;
    const consumed = eligible && !profilesEqual(profile, fallback);
    const claim = {
      profile: cloneProfile(profile),
      fallback,
      version: state.profileSelectionVersion,
      consumed,
    };
    if (consumed) {
      persistPendingProfile(fallback);
      scheduleEnsure();
    }
    return claim;
  };

  const restorePendingProfileClaim = (claim) => {
    if (!claim?.consumed || state.profileSelectionVersion !== claim.version
      || !profilesEqual(resolvePendingProfile(), claim.fallback)) return false;
    persistPendingProfile(claim.profile);
    scheduleEnsure();
    return true;
  };
