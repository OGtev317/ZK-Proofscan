//! arkworks' Groth16 verifier, for ZK-Proofscan, as WebAssembly with two
//! exports: `alloc` and `verify`. No cryptography is written here: this
//! file reads numbers into arkworks' own types, refuses any that are not
//! field elements or points of the right group, and calls
//! `ark_groth16::Groth16::verify_proof`.
//!
//! Input, every number big-endian:
//!   1 byte   curve: 1 = BN254, 2 = BLS12-381
//!   4 bytes  n, the number of public inputs
//!   key      alpha (G1), beta (G2), gamma (G2), delta (G2), n + 1 points (G1)
//!   proof    A (G1), B (G2), C (G1)
//!   n        public inputs, each a scalar of the curve's scalar field
//! A G1 point is a flag byte (0 a point, 1 the point at infinity) then x and
//! y; a G2 point is a flag byte then x.c0, x.c1, y.c0, y.c1. The point at
//! infinity is written with zero coordinates.
//!
//! `verify` returns 1 if arkworks accepts the proof, 0 if it rejects it, and
//! a negative number if the input is not well formed: -1 wrong length or
//! layout, -2 a number that is not a field element, -3 a point not on the
//! curve, -4 a point outside the prime-order subgroup.

// A panic aborts (see `panic = "abort"` in Cargo.toml): the instance traps,
// and the caller treats that as the verifier failing to run.

use ark_ec::{pairing::Pairing, AffineRepr};
use ark_ff::{BigInteger, Fp2, Fp2Config, PrimeField};
use ark_groth16::{Groth16, PreparedVerifyingKey, Proof, VerifyingKey};

enum Fault {
    Layout = -1,
    NotField = -2,
    NotOnCurve = -3,
    NotInSubgroup = -4,
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}
impl<'a> Reader<'a> {
    fn take(&mut self, count: usize) -> Result<&'a [u8], Fault> {
        let end = self.at.checked_add(count).ok_or(Fault::Layout)?;
        let slice = self.bytes.get(self.at..end).ok_or(Fault::Layout)?;
        self.at = end;
        Ok(slice)
    }
    fn byte(&mut self) -> Result<u8, Fault> {
        Ok(self.take(1)?[0])
    }
    /// A field element, refused unless it is written as its one canonical value below the modulus.
    fn field<F: PrimeField>(&mut self) -> Result<F, Fault> {
        let length = F::MODULUS_BIT_SIZE.div_ceil(8) as usize;
        let bytes = self.take(length)?;
        let value = F::from_be_bytes_mod_order(bytes);
        let mut back = value.into_bigint().to_bytes_be();
        // The big integer may be wider than the field's byte length; its extra leading bytes are zero.
        let extra = back.len() - length;
        if back[..extra].iter().any(|byte| *byte != 0) {
            return Err(Fault::NotField);
        }
        back.drain(..extra);
        if back != bytes {
            return Err(Fault::NotField);
        }
        Ok(value)
    }
    fn fp2<P: Fp2Config>(&mut self) -> Result<Fp2<P>, Fault>
    where
        P::Fp: PrimeField,
    {
        let c0 = self.field::<P::Fp>()?;
        let c1 = self.field::<P::Fp>()?;
        Ok(Fp2::new(c0, c1))
    }
}

/// Reads a point with `coordinate`, checking it is on the curve and in the prime-order subgroup.
fn point<A, F>(reader: &mut Reader, coordinate: F) -> Result<A, Fault>
where
    A: AffineRepr,
    F: Fn(&mut Reader) -> Result<A::BaseField, Fault>,
    A: FromXY,
{
    let flag = reader.byte()?;
    let x = coordinate(reader)?;
    let y = coordinate(reader)?;
    match flag {
        1 => {
            if x != A::BaseField::from(0u8) || y != A::BaseField::from(0u8) {
                return Err(Fault::Layout);
            }
            Ok(A::zero())
        }
        0 => {
            let point = A::from_xy(x, y);
            if !point.is_on_curve_() {
                return Err(Fault::NotOnCurve);
            }
            if !point.in_subgroup_() {
                return Err(Fault::NotInSubgroup);
            }
            Ok(point)
        }
        _ => Err(Fault::Layout),
    }
}

/// Builds an affine point from its coordinates without any check; `point` checks it.
trait FromXY: AffineRepr {
    fn from_xy(x: Self::BaseField, y: Self::BaseField) -> Self;
    fn is_on_curve_(&self) -> bool;
    fn in_subgroup_(&self) -> bool;
}
macro_rules! from_xy {
    ($($curve:ty),*) => {$(
        impl FromXY for ark_ec::short_weierstrass::Affine<$curve> {
            fn from_xy(x: Self::BaseField, y: Self::BaseField) -> Self {
                Self::new_unchecked(x, y)
            }
            fn is_on_curve_(&self) -> bool {
                self.is_on_curve()
            }
            fn in_subgroup_(&self) -> bool {
                self.is_in_correct_subgroup_assuming_on_curve()
            }
        }
    )*};
}
from_xy!(ark_bn254::g1::Config, ark_bn254::g2::Config, ark_bls12_381::g1::Config, ark_bls12_381::g2::Config);

macro_rules! check {
    ($name:ident, $curve:ty, $fq:ty, $fq2:ty) => {
        fn $name(reader: &mut Reader, count: usize) -> Result<bool, Fault> {
            type G1 = <$curve as Pairing>::G1Affine;
            type G2 = <$curve as Pairing>::G2Affine;
            type Fr = <$curve as Pairing>::ScalarField;
            let g1 = |r: &mut Reader| point::<G1, _>(r, |r| r.field::<$fq>());
            let g2 = |r: &mut Reader| point::<G2, _>(r, |r| r.fp2::<$fq2>());
            let alpha_g1 = g1(reader)?;
            let beta_g2 = g2(reader)?;
            let gamma_g2 = g2(reader)?;
            let delta_g2 = g2(reader)?;
            let mut gamma_abc_g1 = Vec::with_capacity(count + 1);
            for _ in 0..=count {
                gamma_abc_g1.push(g1(reader)?);
            }
            let key = VerifyingKey::<$curve> { alpha_g1, beta_g2, gamma_g2, delta_g2, gamma_abc_g1 };
            let proof = Proof::<$curve> { a: g1(reader)?, b: g2(reader)?, c: g1(reader)? };
            let mut inputs = Vec::with_capacity(count);
            for _ in 0..count {
                inputs.push(reader.field::<Fr>()?);
            }
            if reader.at != reader.bytes.len() {
                return Err(Fault::Layout);
            }
            let prepared: PreparedVerifyingKey<$curve> = ark_groth16::prepare_verifying_key(&key);
            // A wrong number of inputs is an error from arkworks, and so a rejection.
            Ok(Groth16::<$curve>::verify_proof(&prepared, &proof, &inputs).unwrap_or(false))
        }
    };
}
check!(check_bn254, ark_bn254::Bn254, ark_bn254::Fq, ark_bn254::Fq2Config);
check!(check_bls12_381, ark_bls12_381::Bls12_381, ark_bls12_381::Fq, ark_bls12_381::Fq2Config);

/// Reserves `size` bytes for the caller to write the input into.
#[no_mangle]
pub extern "C" fn alloc(size: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(size);
    let pointer = buffer.as_mut_ptr();
    core::mem::forget(buffer);
    pointer
}

/// Verifies the input written at `pointer`. See the top of this file.
#[no_mangle]
pub extern "C" fn verify(pointer: *const u8, length: usize) -> i32 {
    let bytes = unsafe { core::slice::from_raw_parts(pointer, length) };
    let mut reader = Reader { bytes, at: 0 };
    let result = (|| {
        let curve = reader.byte()?;
        let count = u32::from_be_bytes(reader.take(4)?.try_into().map_err(|_| Fault::Layout)?) as usize;
        if count > 4096 {
            return Err(Fault::Layout);
        }
        match curve {
            1 => check_bn254(&mut reader, count),
            2 => check_bls12_381(&mut reader, count),
            _ => Err(Fault::Layout),
        }
    })();
    match result {
        Ok(true) => 1,
        Ok(false) => 0,
        Err(fault) => fault as i32,
    }
}
