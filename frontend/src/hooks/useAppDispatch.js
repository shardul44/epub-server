/**
 * Typed dispatch hook — use this everywhere instead of plain useDispatch.
 * Gives you full type inference for async thunks.
 */
import { useDispatch } from 'react-redux';

/** @returns {import('@reduxjs/toolkit').ThunkDispatch} */
const useAppDispatch = () => useDispatch();

export default useAppDispatch;
