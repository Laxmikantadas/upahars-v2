import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from './api';
import { notify } from './notify';
export const isValidPhone = (p) => /^[6-9]\d{9}$/.test(p);
const Ctx = createContext(null);
export function AuthProvider({ children, initial }) {
    const [state, setState] = useState(initial ?? { status: 'loading', user: null });
    // On every page load ask the server who we are (the session lives in an HttpOnly cookie).
    useEffect(() => {
        if (initial)
            return;
        let alive = true;
        api('/me')
            .then((r) => alive && setState({ status: 'signedIn', user: r.user }))
            .catch(() => alive && setState({ status: 'anonymous', user: null }));
        return () => { alive = false; };
    }, [initial]);
    const requestOtp = useCallback(async (phone) => {
        const r = await api('/auth/otp/request', { body: { phone } });
        return { devCode: r.devCode };
    }, []);
    const verifyOtp = useCallback(async (phone, code) => {
        const r = await api('/auth/otp/verify', { body: { phone, code } });
        if (r.twoFactorRequired && r.challenge)
            return { kind: 'twoFactor', challenge: r.challenge };
        if (!r.user)
            throw new ApiError(500, 'error', 'Something went wrong. Please try again.');
        setState({ status: 'signedIn', user: r.user });
        notify.success(`Welcome${r.user.name ? ', ' + r.user.name : ''}! You're signed in.`, { title: 'Hi there!', emoji: '👋' });
        return { kind: 'signedIn', user: r.user };
    }, []);
    const requestAdminOtp = useCallback(async (phone) => {
        const r = await api('/auth/admin/otp/request', { body: { phone } });
        return { devCode: r.devCode };
    }, []);
    const verifyAdminOtp = useCallback(async (phone, code) => {
        const r = await api('/auth/admin/otp/verify', { body: { phone, code } });
        if (r.twoFactorRequired && r.challenge)
            return { kind: 'twoFactor', challenge: r.challenge };
        if (!r.user)
            throw new ApiError(500, 'error', 'Something went wrong. Please try again.');
        setState({ status: 'signedIn', user: r.user });
        notify.success('Welcome back, admin!', { title: 'Hi there!', emoji: '👋' });
        return { kind: 'signedIn', user: r.user };
    }, []);
    const verifyTwoFactor = useCallback(async (challenge, code) => {
        const r = await api('/auth/2fa/login', { body: { challenge, code } });
        setState({ status: 'signedIn', user: r.user });
        notify.success('You\'re signed in.', { title: 'Hi there!', emoji: '👋' });
        return r.user;
    }, []);
    const startTwoFactorSetup = useCallback(() => api('/auth/2fa/setup', { body: {} }), []);
    const enableTwoFactor = useCallback(async (code) => {
        const r = await api('/auth/2fa/enable', { body: { code } });
        setState({ status: 'signedIn', user: r.user });
        return r.backupCodes;
    }, []);
    const newBackupCodes = useCallback(async (code) => (await api('/auth/2fa/backup-codes', { body: { code } })).backupCodes, []);
    const disableTwoFactor = useCallback(async (code) => {
        const r = await api('/auth/2fa/disable', { body: { code } });
        setState({ status: 'signedIn', user: r.user });
    }, []);
    const updateProfile = useCallback(async (p) => {
        const r = await api('/me', { method: 'PATCH', body: p });
        setState({ status: 'signedIn', user: r.user });
        return r.user;
    }, []);
    const logout = useCallback(async () => {
        try {
            await api('/auth/logout', { method: 'POST', body: {} });
        }
        catch (e) {
            if (!(e instanceof ApiError))
                throw e;
        }
        setState({ status: 'anonymous', user: null });
        notify.info('You\'re signed out. See you soon!', { title: 'Bye bye!', emoji: '👋' });
    }, []);
    const value = useMemo(() => ({
        ...state, isAdmin: Boolean(state.user?.roles.includes('admin')),
        requestOtp, verifyOtp, requestAdminOtp, verifyAdminOtp, verifyTwoFactor, startTwoFactorSetup, enableTwoFactor, newBackupCodes, disableTwoFactor, updateProfile, logout,
    }), [state, requestOtp, verifyOtp, requestAdminOtp, verifyAdminOtp, verifyTwoFactor, startTwoFactorSetup, enableTwoFactor, newBackupCodes, disableTwoFactor, updateProfile, logout]);
    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useAuth() {
    const a = useContext(Ctx);
    if (!a)
        throw new Error('useAuth must be used inside <AuthProvider>');
    return a;
}
