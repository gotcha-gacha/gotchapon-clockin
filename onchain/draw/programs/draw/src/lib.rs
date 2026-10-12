#![allow(unexpected_cfgs, deprecated)]
// #406: the $1 pull's randomness from MagicBlock VRF. One request per pull sequence, ever: a bit in a
// "used" page is set at request time and never cleared, so closing a draw account (rent back) cannot
// re-open the pull to a second request (Phase 0, check C). The card itself is derived off-chain from
// the 32 bytes this program stores and the pool the Worker froze and hashed at prepare.
use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{vrf, vrf_callback};
use ephemeral_rollups_sdk::vrf::instructions::{create_request_randomness_ix, RequestRandomnessParams};
use ephemeral_rollups_sdk::vrf::types::SerializableAccountMeta;
use solana_sha256_hasher::hashv;

declare_id!("GJZe44ZXk27WxVqXgEbX9tXNpxrPBAA9Z1a7Gd8Rp5ut");

/// Sequences per used page. A program can create an account of at most 10,240 bytes (MAX_PERMITTED_DATA_INCREASE),
/// so the bits are 10,240 minus the 8-byte discriminator and the 8-byte header: 81,792 sequences a page.
pub const PAGE_BYTES: usize = 10_224;
pub const PAGE_BITS: u64 = (PAGE_BYTES as u64) * 8;
/// A draw account may be closed unfulfilled only after MagicBlock's 120 s queue TTL has certainly passed
/// (at ~400 ms a slot, 450 slots is ~180 s), so a late callback never targets a closed account it expects.
pub const CLOSE_UNFULFILLED_AFTER_SLOTS: u64 = 450;

#[program]
pub mod draw {
    use super::*;

    /// Once, by the program's upgrade authority: names the key that may request draws.
    pub fn initialize(ctx: Context<Initialize>, authority: Pubkey) -> Result<()> {
        ctx.accounts.config.authority = authority;
        ctx.accounts.config.bump = ctx.bumps.config;
        Ok(())
    }

    /// The upgrade authority may rotate the requester key.
    pub fn set_authority(ctx: Context<SetAuthority>, authority: Pubkey) -> Result<()> {
        ctx.accounts.config.authority = authority;
        Ok(())
    }

    /// The requester opens the next used page before the sequences it covers are drawn.
    pub fn init_page(ctx: Context<InitPage>, page: u32) -> Result<()> {
        let mut used = ctx.accounts.used.load_init()?;
        used.page = page;
        Ok(())
    }

    /// One MagicBlock request (0.0005 SOL tier) for pull `sequence`. Refused if that sequence was ever requested.
    pub fn request_draw(
        ctx: Context<RequestDraw>,
        sequence: u64,
        pull_id: [u8; 32],
        count: u8,
        pool_hash: [u8; 32],
    ) -> Result<()> {
        require!((1..=10).contains(&count), DrawError::BadCount);
        {
            let mut used = ctx.accounts.used.load_mut()?;
            require!(u64::from(used.page) == sequence / PAGE_BITS, DrawError::WrongPage);
            let bit = sequence % PAGE_BITS;
            let (byte, mask) = ((bit / 8) as usize, 1u8 << (bit % 8));
            require!(used.bits[byte] & mask == 0, DrawError::AlreadyRequested);
            used.bits[byte] |= mask;
        }

        let draw_key = ctx.accounts.draw.key();
        let draw = &mut ctx.accounts.draw;
        draw.sequence = sequence;
        draw.pull_id = pull_id;
        draw.pool_hash = pool_hash;
        draw.count = count;
        draw.request_slot = Clock::get()?.slot;
        draw.bump = ctx.bumps.draw;

        let caller_seed = hashv(&[
            b"gachapon:draw:v1".as_ref(),
            &sequence.to_le_bytes(),
            &pull_id,
            &pool_hash,
        ])
        .to_bytes();
        let ix = create_request_randomness_ix(RequestRandomnessParams {
            payer: ctx.accounts.authority.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: ID,
            callback_discriminator: instruction::FulfillDraw::DISCRIMINATOR.to_vec(),
            caller_seed,
            accounts_metas: Some(vec![SerializableAccountMeta {
                pubkey: draw_key,
                is_signer: false,
                is_writable: true,
            }]),
            callback_args: None,
        });
        ctx.accounts
            .invoke_signed_vrf(&ctx.accounts.authority.to_account_info(), &ix)?;
        Ok(())
    }

    /// Only MagicBlock's VRF program can call this (`#[vrf_callback]`). It never fails on valid input: a
    /// failing callback reverts the fulfilment, and an unfulfilled request's fee goes to the oracle.
    pub fn fulfill_draw(ctx: Context<FulfillDraw>, randomness: [u8; 32]) -> Result<()> {
        let draw = &mut ctx.accounts.draw;
        if draw.fulfilled_slot == 0 {
            draw.randomness = randomness;
            draw.fulfilled_slot = Clock::get()?.slot;
        }
        Ok(())
    }

    /// The requester takes the rent back once the pull has settled (or certainly never will be fulfilled).
    /// The used bit stays set, and the randomness stays in the oracle's fulfilment transaction.
    pub fn close_draw(ctx: Context<CloseDraw>) -> Result<()> {
        let draw = &ctx.accounts.draw;
        let now = Clock::get()?.slot;
        require!(
            draw.fulfilled_slot != 0 || now > draw.request_slot + CLOSE_UNFULFILLED_AFTER_SLOTS,
            DrawError::StillPending
        );
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub upgrade_authority: Signer<'info>,
    #[account(init, payer = upgrade_authority, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()))]
    pub program: Program<'info, crate::program::Draw>,
    #[account(constraint = program_data.upgrade_authority_address == Some(upgrade_authority.key()) @ DrawError::NotUpgradeAuthority)]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetAuthority<'info> {
    pub upgrade_authority: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()))]
    pub program: Program<'info, crate::program::Draw>,
    #[account(constraint = program_data.upgrade_authority_address == Some(upgrade_authority.key()) @ DrawError::NotUpgradeAuthority)]
    pub program_data: Account<'info, ProgramData>,
}

#[derive(Accounts)]
#[instruction(page: u32)]
pub struct InitPage<'info> {
    #[account(mut, address = config.authority @ DrawError::NotAuthority)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(init, payer = authority, space = 8 + std::mem::size_of::<UsedPage>(),
        seeds = [b"used", page.to_le_bytes().as_ref()], bump)]
    pub used: AccountLoader<'info, UsedPage>,
    pub system_program: Program<'info, System>,
}

#[vrf]
#[derive(Accounts)]
#[instruction(sequence: u64)]
pub struct RequestDraw<'info> {
    #[account(mut, address = config.authority @ DrawError::NotAuthority)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"used", ((sequence / PAGE_BITS) as u32).to_le_bytes().as_ref()], bump)]
    pub used: AccountLoader<'info, UsedPage>,
    #[account(init, payer = authority, space = 8 + Draw::INIT_SPACE,
        seeds = [b"draw", sequence.to_le_bytes().as_ref()], bump)]
    pub draw: Account<'info, Draw>,
    /// CHECK: pinned to MagicBlock's base-layer queue.
    #[account(mut, address = ephemeral_rollups_sdk::vrf::consts::DEFAULT_QUEUE)]
    pub oracle_queue: AccountInfo<'info>,
}

#[vrf_callback]
#[derive(Accounts)]
pub struct FulfillDraw<'info> {
    #[account(mut)]
    pub draw: Account<'info, Draw>,
}

#[derive(Accounts)]
pub struct CloseDraw<'info> {
    #[account(mut, address = config.authority @ DrawError::NotAuthority)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, close = authority, seeds = [b"draw", draw.sequence.to_le_bytes().as_ref()], bump = draw.bump)]
    pub draw: Account<'info, Draw>,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub bump: u8,
}

#[account(zero_copy)]
pub struct UsedPage {
    pub page: u32,
    pub _pad: [u8; 4],
    pub bits: [u8; PAGE_BYTES],
}

/// Byte layout (after the 8-byte discriminator) is read by the Worker without an IDL:
/// sequence u64 @8 | pull_id @16 | pool_hash @48 | randomness @80 | request_slot u64 @112 | fulfilled_slot u64 @120 | count @128 | bump @129
#[account]
#[derive(InitSpace)]
pub struct Draw {
    pub sequence: u64,
    pub pull_id: [u8; 32],
    pub pool_hash: [u8; 32],
    pub randomness: [u8; 32],
    pub request_slot: u64,
    pub fulfilled_slot: u64,
    pub count: u8,
    pub bump: u8,
}

#[error_code]
pub enum DrawError {
    #[msg("count must be 1..=10")]
    BadCount,
    #[msg("that pull sequence was already requested")]
    AlreadyRequested,
    #[msg("used page does not cover this sequence")]
    WrongPage,
    #[msg("signer is not the draw authority")]
    NotAuthority,
    #[msg("signer is not the program's upgrade authority")]
    NotUpgradeAuthority,
    #[msg("draw is still pending")]
    StillPending,
}
